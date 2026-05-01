import {
  getUnprocessedEnvelopeId,
  hasUnprocessedMarker,
  isActionableUnprocessedLine,
  removeUnprocessedMarker,
} from "../../src/agora/UnprocessedMarker";

describe("UnprocessedMarker", () => {
  it("detects old and enriched unprocessed markers", () => {
    expect(hasUnprocessedMarker("request: **[UNPROCESSED]** hello")).toBe(true);
    expect(hasUnprocessedMarker("request: **[UNPROCESSED envelopeId=env-123]** hello")).toBe(true);
    expect(hasUnprocessedMarker("request: **[PROCESSED envelopeId=env-123]** hello")).toBe(false);
  });

  it("extracts envelopeId from enriched markers", () => {
    expect(getUnprocessedEnvelopeId("request: **[UNPROCESSED envelopeId=env-123]** hello")).toBe("env-123");
    expect(getUnprocessedEnvelopeId("request: **[UNPROCESSED]** hello")).toBeNull();
  });

  it("removes the complete unprocessed badge", () => {
    expect(removeUnprocessedMarker("request: **[UNPROCESSED]** hello")).toBe("request: hello");
    expect(removeUnprocessedMarker("request: **[UNPROCESSED envelopeId=env-123]** hello")).toBe("request: hello");
  });

  it("detects actionable Agora and TinyBus formats but ignores announce", () => {
    expect(isActionableUnprocessedLine("request: **[UNPROCESSED envelopeId=env-123]** hello")).toBe(true);
    expect(isActionableUnprocessedLine("**peer** (notify) **[UNPROCESSED]** hello")).toBe(true);
    expect(isActionableUnprocessedLine("announce: **[UNPROCESSED envelopeId=env-123]** hello")).toBe(false);
  });
});
