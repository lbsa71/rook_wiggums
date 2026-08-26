import { EventGateStore } from "../../src/loop/EventGateStore";
import { InMemoryFileSystem } from "../../src/substrate/abstractions/InMemoryFileSystem";

const STATE_PATH = "/state/event_gates.json";
const TASK = "Verify deployment after a natural rebuild";
const REQUEST = {
  releaseCondition: {
    type: "dependency_fingerprint_changed" as const,
    dependencies: [{ path: "/source/dist/version.json", observation: "content" as const }],
  },
};

async function setup(): Promise<{ fs: InMemoryFileSystem; warnings: string[]; store: EventGateStore }> {
  const fs = new InMemoryFileSystem();
  await fs.mkdir("/source/dist", { recursive: true });
  await fs.writeFile("/source/dist/version.json", '{"gitHash":"old"}');
  const warnings: string[] = [];
  const store = new EventGateStore(fs, STATE_PATH, ["/source"], (message) => warnings.push(message));
  return { fs, warnings, store };
}

describe("EventGateStore", () => {
  it("persists one gate record and keeps an unchanged dependency ineligible", async () => {
    const { fs, store } = await setup();

    await store.arm("task-1", TASK, REQUEST, "2026-08-26T00:00:00.000Z", 45_000, 320);
    await store.confirmStatusWritten("task-1");

    const state = JSON.parse(await fs.readFile(STATE_PATH)) as { version: number; gates: unknown[] };
    expect(state.version).toBe(1);
    expect(state.gates).toHaveLength(1);
    await expect(store.evaluate("task-1", TASK)).resolves.toMatchObject({
      eligible: false,
      reason: "unchanged",
      record: { baselineDispatchLatencyMs: 45_000, baselineStatusBytes: 320 },
    });
    // An unchanged check does not append or rewrite status history.
    expect(JSON.parse(await fs.readFile(STATE_PATH)).gates).toHaveLength(1);
  });

  it("releases and clears a gate when dependency content changes", async () => {
    const { fs, store } = await setup();
    await store.arm("task-1", TASK, REQUEST, "2026-08-26T00:00:00.000Z", 1, 1);
    await store.confirmStatusWritten("task-1");

    await fs.writeFile("/source/dist/version.json", '{"gitHash":"new"}');

    await expect(store.evaluate("task-1", TASK)).resolves.toEqual({
      eligible: true,
      reason: "dependency_changed",
    });
    await expect(fs.exists(STATE_PATH)).resolves.toBe(false);
  });

  it("tracks missing/present transitions with existence observation", async () => {
    const { fs, store } = await setup();
    const request = {
      releaseCondition: {
        type: "dependency_fingerprint_changed" as const,
        dependencies: [{ path: "/source/stopped-by-user", observation: "existence" as const }],
      },
    };
    await store.arm("task-1", TASK, request, "2026-08-26T00:00:00.000Z", 1, 1);
    await store.confirmStatusWritten("task-1");
    await expect(store.evaluate("task-1", TASK)).resolves.toMatchObject({ eligible: false });

    await fs.writeFile("/source/stopped-by-user", "stopped");
    await expect(store.evaluate("task-1", TASK)).resolves.toEqual({
      eligible: true,
      reason: "dependency_changed",
    });
  });

  it("clears a stale gate when the task occupying the id changes", async () => {
    const { fs, store } = await setup();
    await store.arm("task-1", TASK, REQUEST, "2026-08-26T00:00:00.000Z", 1, 1);
    await store.confirmStatusWritten("task-1");

    await expect(store.evaluate("task-1", "A different task after PLAN editing")).resolves.toEqual({
      eligible: true,
      reason: "task_changed",
    });
    await expect(fs.exists(STATE_PATH)).resolves.toBe(false);
  });

  it("fails open on corrupt state", async () => {
    const { fs, warnings, store } = await setup();
    await fs.mkdir("/state", { recursive: true });
    await fs.writeFile(STATE_PATH, "{not-json");

    await expect(store.evaluate("task-1", TASK)).resolves.toEqual({ eligible: true, reason: "no_gate" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("corrupt event-gate state");
    await expect(fs.exists(STATE_PATH)).resolves.toBe(false);
  });

  it("rejects paths outside configured roots without persisting state", async () => {
    const { fs, store } = await setup();
    const request = {
      releaseCondition: {
        type: "dependency_fingerprint_changed" as const,
        dependencies: [{ path: "/secrets/token", observation: "existence" as const }],
      },
    };

    await expect(store.arm("task-1", TASK, request, "2026-08-26T00:00:00.000Z", 1, 1))
      .rejects.toThrow("outside configured roots");
    await expect(fs.exists(STATE_PATH)).resolves.toBe(false);
  });

  it("fails open without reading a persisted dependency outside configured roots", async () => {
    const { fs, warnings, store } = await setup();
    await fs.mkdir("/state", { recursive: true });
    await fs.mkdir("/secrets", { recursive: true });
    await fs.writeFile("/secrets/token", "do-not-read");
    await fs.writeFile(STATE_PATH, JSON.stringify({
      version: 1,
      gates: [{
        taskId: "task-1",
        taskDescriptionFingerprint: "ignored-before-path-check",
        observedConditionFingerprint: "old",
        releaseCondition: {
          type: "dependency_fingerprint_changed",
          dependencies: [{ path: "/secrets/token", observation: "content" }],
        },
        createdAt: "2026-08-26T00:00:00.000Z",
        baselineDispatchLatencyMs: 1,
        baselineStatusBytes: 1,
      }],
    }));

    // Match the persisted description hash by first arming a valid record and
    // then replacing only its release condition with the malicious path.
    await store.arm("task-1", TASK, REQUEST, "2026-08-26T00:00:00.000Z", 1, 1);
    await store.confirmStatusWritten("task-1");
    const state = JSON.parse(await fs.readFile(STATE_PATH));
    state.gates[0].releaseCondition.dependencies = [{ path: "/secrets/token", observation: "content" }];
    await fs.writeFile(STATE_PATH, JSON.stringify(state));

    await expect(store.evaluate("task-1", TASK)).resolves.toEqual({
      eligible: true,
      reason: "inspection_failed",
    });
    expect(warnings.some((message) => message.includes("outside configured roots"))).toBe(true);
    await expect(fs.exists(STATE_PATH)).resolves.toBe(false);
  });

  it("fails open after a crash before the first durable status is confirmed", async () => {
    const { fs, store } = await setup();
    await store.arm("task-1", TASK, REQUEST, "2026-08-26T00:00:00.000Z", 1, 1);

    const reconstructed = new EventGateStore(fs, STATE_PATH, ["/source"], () => undefined);
    await expect(reconstructed.evaluate("task-1", TASK)).resolves.toEqual({
      eligible: true,
      reason: "status_unconfirmed",
    });
    await expect(fs.exists(STATE_PATH)).resolves.toBe(false);
  });
});
