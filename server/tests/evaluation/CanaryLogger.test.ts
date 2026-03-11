import { CanaryLogger, CanaryRecord } from "../../src/evaluation/CanaryLogger";
import { InMemoryFileSystem } from "../../src/substrate/abstractions/InMemoryFileSystem";

describe("CanaryLogger", () => {
  let fs: InMemoryFileSystem;
  let logger: CanaryLogger;
  const filePath = "/data/canary-log.jsonl";

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    logger = new CanaryLogger(fs, filePath);
  });

  const makeRecord = (overrides: Partial<CanaryRecord> = {}): CanaryRecord => ({
    timestamp: "2026-03-11T03:00:00.000Z",
    cycle: 42,
    launcher: "claude",
    candidateCount: 3,
    highPriorityConfidence: 87,
    parseErrors: 0,
    pass: true,
    ...overrides,
  });

  describe("recordCycle", () => {
    it("creates the data directory and appends a JSONL record", async () => {
      await logger.recordCycle(makeRecord());

      const content = await fs.readFile(filePath);
      const parsed = JSON.parse(content.trim()) as CanaryRecord;
      expect(parsed.cycle).toBe(42);
      expect(parsed.launcher).toBe("claude");
      expect(parsed.candidateCount).toBe(3);
      expect(parsed.pass).toBe(true);
    });

    it("appends multiple records as separate JSONL lines", async () => {
      await logger.recordCycle(makeRecord({ cycle: 1, candidateCount: 5 }));
      await logger.recordCycle(makeRecord({ cycle: 2, candidateCount: 0, pass: false }));

      const content = await fs.readFile(filePath);
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect((JSON.parse(lines[0]) as CanaryRecord).cycle).toBe(1);
      expect((JSON.parse(lines[0]) as CanaryRecord).candidateCount).toBe(5);
      expect((JSON.parse(lines[1]) as CanaryRecord).cycle).toBe(2);
      expect((JSON.parse(lines[1]) as CanaryRecord).pass).toBe(false);
    });

    it("creates directory if it does not exist", async () => {
      // No mkdir called beforehand — CanaryLogger should create the dir
      await logger.recordCycle(makeRecord());

      const content = await fs.readFile(filePath);
      expect(content.trim()).toBeTruthy();
    });

    it("records null highPriorityConfidence correctly", async () => {
      await logger.recordCycle(makeRecord({ highPriorityConfidence: null }));

      const content = await fs.readFile(filePath);
      const parsed = JSON.parse(content.trim()) as CanaryRecord;
      expect(parsed.highPriorityConfidence).toBeNull();
    });

    it("records parse errors and fail verdict correctly", async () => {
      await logger.recordCycle(makeRecord({ candidateCount: 0, parseErrors: 1, pass: false }));

      const content = await fs.readFile(filePath);
      const parsed = JSON.parse(content.trim()) as CanaryRecord;
      expect(parsed.parseErrors).toBe(1);
      expect(parsed.pass).toBe(false);
    });
  });
});
