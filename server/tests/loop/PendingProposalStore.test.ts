import { PendingProposalStore } from "../../src/loop/PendingProposalStore";
import { InMemoryFileSystem } from "../../src/substrate/abstractions/InMemoryFileSystem";

const STATE_PATH = "/data/pending_proposals.json";

describe("PendingProposalStore", () => {
  it("atomically persists proposals and coalesces exact duplicates", async () => {
    const fs = new InMemoryFileSystem();
    const warnings: string[] = [];
    const store = new PendingProposalStore(fs, STATE_PATH, (message) => warnings.push(message));
    const proposal = { target: "SKILLS", content: "# Skills", mode: "replace" as const };

    await store.mergeAndPersist([proposal, proposal]);

    await expect(store.load()).resolves.toEqual([proposal]);
    await expect(fs.exists(`${STATE_PATH}.tmp`)).resolves.toBe(false);
    expect(warnings).toEqual([]);
  });

  it("fails open on corrupt state and replaces it on the next persist", async () => {
    const fs = new InMemoryFileSystem();
    await fs.mkdir("/data", { recursive: true });
    await fs.writeFile(STATE_PATH, "{not-json");
    const warnings: string[] = [];
    const store = new PendingProposalStore(fs, STATE_PATH, (message) => warnings.push(message));
    const proposal = { target: "MEMORY", content: "# Memory", mode: "replace" as const };

    await expect(store.load()).resolves.toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("corrupt pending proposal state");

    await store.mergeAndPersist([proposal]);
    await expect(store.load()).resolves.toEqual([proposal]);
  });

  it("clears persisted state idempotently", async () => {
    const fs = new InMemoryFileSystem();
    const store = new PendingProposalStore(fs, STATE_PATH, () => undefined);
    await store.mergeAndPersist([{ target: "PLAN", content: "- [ ] task" }]);

    await store.clear();
    await store.clear();

    await expect(store.load()).resolves.toEqual([]);
  });
});
