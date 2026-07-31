import { stripThinkPreamble } from "../../../src/agents/ollama/stripThinkPreamble";

describe("stripThinkPreamble", () => {
  it("removes a leading single-line <think> block", () => {
    expect(stripThinkPreamble('<think>some reasoning</think>\n{"key":"value"}')).toBe(
      '{"key":"value"}'
    );
  });

  it("removes a multiline <think> block and case-insensitive tags", () => {
    expect(stripThinkPreamble("<THINK>\nstep 1\nstep 2\n</Think>\n\nfinal answer")).toBe(
      "final answer"
    );
  });

  it("leaves content without think tags unchanged (aside from leading trim)", () => {
    expect(stripThinkPreamble('{"key":"value"}')).toBe('{"key":"value"}');
  });

  it("falls back to the original when the response is ONLY a think block", () => {
    const only = "<think>reasoning only, no answer</think>";
    expect(stripThinkPreamble(only)).toBe(only);
  });

  it("only strips the leading block, not a later inline mention", () => {
    const input = "real summary that mentions <think> as a literal word later";
    expect(stripThinkPreamble(input)).toBe(input);
  });
});
