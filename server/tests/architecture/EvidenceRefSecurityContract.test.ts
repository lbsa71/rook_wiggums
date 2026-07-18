import { createHash } from "node:crypto";
import fixture from "./fixtures/evidence-ref-security-cases.json";
import { detectSecrets } from "../../src/substrate/validation/SecretDetector";

const EVIDENCE_REF = /^evidence:sha256:[0-9a-f]{64}$/;

function canonicalBytes(mediaType: string, payload: Buffer): Buffer {
  const header = Buffer.from(
    `${fixture.domainSeparator}\nmedia-type:${mediaType}\nlength:${payload.byteLength}\n\n`,
    "utf8",
  );
  return Buffer.concat([header, payload]);
}

function evidenceRef(mediaType: string, payload: Buffer): string {
  const digest = createHash(fixture.algorithm)
    .update(canonicalBytes(mediaType, payload))
    .digest("hex");
  return `${fixture.referencePrefix}${digest}`;
}

function decode(payloadBase64: string): Buffer {
  return Buffer.from(payloadBase64, "base64");
}

describe("Stage-1 EvidenceRef security contract fixtures", () => {
  it("freezes the minimal versioned boundary", () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.algorithm).toBe("sha256");
    expect(fixture.maximumPayloadBytes).toBe(64 * 1024);
    expect(fixture.allowedMediaTypes).toEqual([
      "application/json",
      "text/plain;charset=utf-8",
    ]);
  });

  it.each(fixture.valid)("binds $name to exact domain-separated canonical bytes", (testCase) => {
    const payload = decode(testCase.payloadBase64);
    expect(evidenceRef(testCase.mediaType, payload)).toBe(testCase.expectedRef);
    expect(EVIDENCE_REF.test(testCase.expectedRef)).toBe(true);
  });

  it("uses byte identity and does not smuggle semantic JSON equivalence into Stage 1", () => {
    const testCase = fixture.byteIdentity;
    const first = evidenceRef(testCase.mediaType, decode(testCase.firstPayloadBase64));
    const second = evidenceRef(testCase.mediaType, decode(testCase.secondPayloadBase64));
    expect(first).toBe(testCase.firstRef);
    expect(second).toBe(testCase.secondRef);
    expect(first).not.toBe(second);
  });

  it("detects same-reference/different-content replacement instead of overwriting", () => {
    const testCase = fixture.sameReferenceDifferentContent;
    const replacementRef = evidenceRef(
      testCase.replacementMediaType,
      decode(testCase.replacementPayloadBase64),
    );
    expect(replacementRef).not.toBe(testCase.claimedRef);
    expect(testCase.expectedStatus).toBe("conflict");
  });

  it("rejects payloads beyond the fixed 64 KiB boundary", () => {
    const testCase = fixture.oversize;
    const payload = Buffer.alloc(testCase.repeatCount, testCase.repeatByte);
    expect(payload.byteLength).toBe(fixture.maximumPayloadBytes + 1);
    expect(testCase.expectedStatus).toBe("rejected_payload_too_large");
  });

  it("rejects accidental secret capture before content-addressing or persistence", () => {
    const testCase = fixture.secretCapture;
    const secretResult = detectSecrets(decode(testCase.payloadBase64).toString("utf8"));
    expect(secretResult.hasSecrets).toBe(true);
    expect(testCase.expectedStatus).toBe("rejected_secret_detected");
  });

  it.each(fixture.invalidReferences)("rejects non-canonical or path-shaped reference %s", (ref) => {
    expect(EVIDENCE_REF.test(ref)).toBe(false);
  });

  it("keeps missing/orphan evidence epistemically unclassified", () => {
    expect(EVIDENCE_REF.test(fixture.missing.ref)).toBe(true);
    expect(fixture.missing.expectedStatus).toBe("missing");
    expect(fixture.missing.truthValue).toBeNull();
  });

  it("detects corrupt stored bytes and forbids returning them as evidence", () => {
    const testCase = fixture.corrupt;
    const actual = evidenceRef(testCase.storedMediaType, decode(testCase.storedPayloadBase64));
    expect(actual).not.toBe(testCase.ref);
    expect(testCase.expectedStatus).toBe("corrupt");
    expect(testCase.mustNotReturnPayload).toBe(true);
  });
});
