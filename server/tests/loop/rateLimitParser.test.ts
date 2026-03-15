import { parseRateLimitReset, computeProgressiveBackoff } from "../../src/loop/rateLimitParser";

describe("parseRateLimitReset", () => {
  it("parses 'resets 7pm (UTC)' from rate limit message", () => {
    const result = parseRateLimitReset(
      "You've hit your limit · resets 7pm (UTC)",
      new Date("2026-02-09T18:30:00Z"),
    );
    expect(result).toEqual(new Date("2026-02-09T19:00:00Z"));
  });

  it("parses 'resets 3am (UTC)' crossing midnight", () => {
    const result = parseRateLimitReset(
      "You've hit your limit · resets 3am (UTC)",
      new Date("2026-02-09T23:30:00Z"),
    );
    // 3am UTC is next day
    expect(result).toEqual(new Date("2026-02-10T03:00:00Z"));
  });

  it("parses 12pm (UTC) as noon", () => {
    const result = parseRateLimitReset(
      "You've hit your limit · resets 12pm (UTC)",
      new Date("2026-02-09T10:00:00Z"),
    );
    expect(result).toEqual(new Date("2026-02-09T12:00:00Z"));
  });

  it("parses 12am (UTC) as midnight", () => {
    const result = parseRateLimitReset(
      "You've hit your limit · resets 12am (UTC)",
      new Date("2026-02-09T22:00:00Z"),
    );
    expect(result).toEqual(new Date("2026-02-10T00:00:00Z"));
  });

  it("returns null for non-rate-limit messages", () => {
    expect(parseRateLimitReset("Hello world", new Date())).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseRateLimitReset("", new Date())).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseRateLimitReset(undefined, new Date())).toBeNull();
  });

  it("parses 'resets Feb 14, 10am (UTC)' with date prefix", () => {
    const result = parseRateLimitReset(
      "You've hit your limit · resets Feb 14, 10am (UTC)",
      new Date("2026-02-10T06:35:00Z"),
    );
    expect(result).toEqual(new Date("2026-02-14T10:00:00Z"));
  });

  it("parses 'resets Mar 1, 3pm (UTC)' with date prefix", () => {
    const result = parseRateLimitReset(
      "You've hit your limit · resets Mar 1, 3pm (UTC)",
      new Date("2026-02-28T20:00:00Z"),
    );
    expect(result).toEqual(new Date("2026-03-01T15:00:00Z"));
  });

  it("parses 'resets Jan 5, 12am (UTC)' as midnight", () => {
    const result = parseRateLimitReset(
      "You've hit your limit · resets Jan 5, 12am (UTC)",
      new Date("2026-01-04T22:00:00Z"),
    );
    expect(result).toEqual(new Date("2026-01-05T00:00:00Z"));
  });

  it("handles rate limit in longer output text", () => {
    const result = parseRateLimitReset(
      "Some prefix text\nYou've hit your limit · resets 5pm (UTC)\nSome suffix",
      new Date("2026-02-09T14:00:00Z"),
    );
    expect(result).toEqual(new Date("2026-02-09T17:00:00Z"));
  });

  it("returns null when resetsAt is unknown (no time in message)", () => {
    const now = new Date("2026-02-09T18:30:00Z");
    const result = parseRateLimitReset(
      "You've hit your limit · rate limited",
      now,
    );
    expect(result).toBeNull();
  });
});

describe("computeProgressiveBackoff", () => {
  it("returns 5 minutes for first unknown rate limit (n=0)", () => {
    expect(computeProgressiveBackoff(0)).toBe(5 * 60 * 1000);
  });

  it("returns 10 minutes for n=1", () => {
    expect(computeProgressiveBackoff(1)).toBe(10 * 60 * 1000);
  });

  it("returns 20 minutes for n=2", () => {
    expect(computeProgressiveBackoff(2)).toBe(20 * 60 * 1000);
  });

  it("returns 40 minutes for n=3", () => {
    expect(computeProgressiveBackoff(3)).toBe(40 * 60 * 1000);
  });

  it("returns 80 minutes for n=4", () => {
    expect(computeProgressiveBackoff(4)).toBe(80 * 60 * 1000);
  });

  it("caps at 2 hours for n=5", () => {
    expect(computeProgressiveBackoff(5)).toBe(2 * 60 * 60 * 1000);
  });

  it("caps at 2 hours for n=10", () => {
    expect(computeProgressiveBackoff(10)).toBe(2 * 60 * 60 * 1000);
  });
});
