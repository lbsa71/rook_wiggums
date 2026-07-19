import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  computeEvidenceRef,
  EvidenceRefRegistry,
  MAX_EVIDENCE_PAYLOAD_BYTES,
  parseEvidenceRef,
} from "../../src/causal/EvidenceRefRegistry";
import { recordVersion } from "../../src/causal/Identifiers";
import fixture from "./fixtures/evidence-ref-security-cases.json";

function decode(value: string): Buffer {
  return Buffer.from(value, "base64");
}

describe("EvidenceRefRegistry", () => {
  let parent: string;
  let root: string;

  beforeEach(async () => {
    parent = await fs.mkdtemp(path.join(os.tmpdir(), "rook-evidence-registry-"));
    root = path.join(parent, "registry");
  });

  afterEach(async () => {
    await fs.rm(parent, { recursive: true, force: true });
  });

  it.each(fixture.valid)("registers and resolves exact $name", async (testCase) => {
    const registry = new EvidenceRefRegistry(root);
    const payload = decode(testCase.payloadBase64);

    const first = await registry.register(testCase.mediaType, payload);
    expect(first).toEqual({ status: "registered", ref: testCase.expectedRef });
    expect(await registry.register(testCase.mediaType, payload))
      .toEqual({ status: "already_registered", ref: testCase.expectedRef });

    const resolved = await registry.resolve(testCase.expectedRef);
    expect(resolved.status).toBe("resolved");
    if (resolved.status === "resolved") {
      expect(resolved.mediaType).toBe(testCase.mediaType);
      expect(resolved.payload).toEqual(payload);
      expect(resolved.payload).not.toBe(payload);
    }
  });

  it("uses byte identity rather than semantic JSON identity", async () => {
    const registry = new EvidenceRefRegistry(root);
    const first = await registry.register(
      fixture.byteIdentity.mediaType,
      decode(fixture.byteIdentity.firstPayloadBase64),
    );
    const second = await registry.register(
      fixture.byteIdentity.mediaType,
      decode(fixture.byteIdentity.secondPayloadBase64),
    );
    expect(first).toMatchObject({ ref: fixture.byteIdentity.firstRef });
    expect(second).toMatchObject({ ref: fixture.byteIdentity.secondRef });
  });

  it("rejects unsupported media, oversize, invalid UTF-8, invalid JSON, and secrets", async () => {
    const registry = new EvidenceRefRegistry(root);
    await expect(registry.register("text/html", Buffer.from("ok"))).resolves.toEqual({
      status: "rejected",
      reason: "rejected_media_type",
    });
    await expect(registry.register(
      fixture.oversize.mediaType,
      Buffer.alloc(MAX_EVIDENCE_PAYLOAD_BYTES + 1, fixture.oversize.repeatByte),
    )).resolves.toEqual({ status: "rejected", reason: fixture.oversize.expectedStatus });
    await expect(registry.register("text/plain;charset=utf-8", Buffer.from([0xc3, 0x28])))
      .resolves.toEqual({ status: "rejected", reason: "rejected_invalid_utf8" });
    await expect(registry.register("application/json", Buffer.from("{nope", "utf8")))
      .resolves.toEqual({ status: "rejected", reason: "rejected_invalid_json" });
    await expect(registry.register(
      fixture.secretCapture.mediaType,
      decode(fixture.secretCapture.payloadBase64),
    )).resolves.toEqual({ status: "rejected", reason: fixture.secretCapture.expectedStatus });
    await expect(fs.readdir(parent)).resolves.toEqual([]);
  });

  it.each(fixture.invalidReferences)("rejects non-canonical reference %s", async (ref) => {
    const registry = new EvidenceRefRegistry(root);
    expect(parseEvidenceRef(ref)).toBeNull();
    await expect(registry.resolve(ref)).resolves.toEqual({
      status: "rejected",
      reason: "rejected_invalid_reference",
    });
  });

  it("reports valid absent refs as missing and orphaned without truth semantics", async () => {
    const registry = new EvidenceRefRegistry(root);
    await expect(registry.resolve(fixture.missing.ref)).resolves.toEqual({
      status: "missing",
      ref: fixture.missing.ref,
    });
    await expect(registry.reportOrphans([fixture.missing.ref, "not-a-ref"]))
      .resolves.toEqual([fixture.missing.ref]);
  });

  it("returns corrupt with no payload for mutation and symlink entries", async () => {
    const registry = new EvidenceRefRegistry(root);
    const valid = fixture.valid[0];
    await registry.register(valid.mediaType, decode(valid.payloadBase64));
    const digest = valid.expectedRef.slice("evidence:sha256:".length);
    const entryPath = path.join(root, `${digest}.json`);
    await fs.writeFile(entryPath, JSON.stringify({
      schemaVersion: 1,
      mediaType: fixture.corrupt.storedMediaType,
      payloadBase64: fixture.corrupt.storedPayloadBase64,
    }));
    expect(await registry.resolve(valid.expectedRef)).toEqual({
      status: "corrupt",
      ref: valid.expectedRef,
    });
    expect(await registry.register(valid.mediaType, decode(valid.payloadBase64))).toEqual({
      status: "conflict",
      ref: valid.expectedRef,
    });

    await fs.rm(entryPath);
    const outside = path.join(parent, "outside.json");
    await fs.writeFile(outside, "{}", "utf8");
    await fs.symlink(outside, entryPath);
    expect(await registry.resolve(valid.expectedRef)).toEqual({
      status: "corrupt",
      ref: valid.expectedRef,
    });
  });

  it("coalesces concurrent registration without overwriting", async () => {
    const registry = new EvidenceRefRegistry(root);
    const testCase = fixture.valid[1];
    const payload = decode(testCase.payloadBase64);
    const results = await Promise.all(Array.from(
      { length: 12 },
      () => registry.register(testCase.mediaType, payload),
    ));
    expect(results.filter((result) => result.status === "registered")).toHaveLength(1);
    expect(results.filter((result) => result.status === "already_registered")).toHaveLength(11);
    expect(await registry.resolve(testCase.expectedRef)).toMatchObject({ status: "resolved" });
  });

  it("fails closed for resolution and fail-open for the wider runtime when root is unsafe", async () => {
    const events: Array<{ status: string }> = [];
    const target = path.join(parent, "real-root");
    await fs.mkdir(target);
    await fs.symlink(target, root);
    const registry = new EvidenceRefRegistry(root, { audit: (event) => events.push(event) });
    const ref = computeEvidenceRef("text/plain;charset=utf-8", Buffer.from("safe", "utf8"));

    expect(await registry.resolve(ref)).toEqual({ status: "unavailable", ref });
    expect(await registry.register("text/plain;charset=utf-8", Buffer.from("safe", "utf8")))
      .toEqual({ status: "unavailable" });
    expect(events.map((event) => event.status)).toEqual(["unavailable", "unavailable"]);
  });

  it("retains only the frozen primitive validation behavior", () => {
    expect(recordVersion(0)).toBe(0);
    expect(recordVersion(42)).toBe(42);
    expect(() => recordVersion(-1)).toThrow("non-negative safe integer");
    expect(() => recordVersion(1.5)).toThrow("non-negative safe integer");
  });
});
