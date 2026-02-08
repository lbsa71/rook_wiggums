import { validateSubstrateContent } from "../../../src/substrate/validation/validators";
import { SubstrateFileType } from "../../../src/substrate/types";

describe("validateSubstrateContent", () => {
  describe("common rules (all file types)", () => {
    it("rejects empty content", () => {
      const result = validateSubstrateContent("", SubstrateFileType.MEMORY);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Content must not be empty");
    });

    it("rejects content without a heading", () => {
      const result = validateSubstrateContent(
        "No heading here",
        SubstrateFileType.MEMORY
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Content must start with a # heading");
    });

    it("accepts content with a valid heading", () => {
      const result = validateSubstrateContent(
        "# Memory\n\nSome content",
        SubstrateFileType.MEMORY
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("PLAN-specific rules", () => {
    it("rejects PLAN without any ## section", () => {
      const result = validateSubstrateContent(
        "# Plan\n\nJust text",
        SubstrateFileType.PLAN
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "PLAN must have at least one ## section"
      );
    });

    it("accepts PLAN with a ## section", () => {
      const result = validateSubstrateContent(
        "# Plan\n\n## Current Goal\n\nDo something",
        SubstrateFileType.PLAN
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("non-PLAN files do not require ## sections", () => {
    it("accepts MEMORY without ## sections", () => {
      const result = validateSubstrateContent(
        "# Memory\n\nJust notes",
        SubstrateFileType.MEMORY
      );
      expect(result.valid).toBe(true);
    });
  });
});
