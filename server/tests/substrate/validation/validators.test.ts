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

    it("rejects PLAN without ## Tasks section", () => {
      const result = validateSubstrateContent(
        "# Plan\n\n## Current Goal\n\nDo something\n\n## Next Steps\n\n- Something",
        SubstrateFileType.PLAN
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "PLAN must have a ## Tasks section"
      );
    });

    it("accepts PLAN with ## Tasks section", () => {
      const result = validateSubstrateContent(
        "# Plan\n\n## Current Goal\n\nDo something\n\n## Tasks\n\n- [ ] First task",
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

  describe("secret detection integration", () => {
    it("rejects content with API keys", () => {
      const content = '# Plan\n\n## Tasks\n\napi_key: "abcdef1234567890abcdef1234567890abcdef12"';
      const result = validateSubstrateContent(content, SubstrateFileType.PLAN);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Generic API Key"))).toBe(true);
    });

    it("rejects content with tokens", () => {
      const content = '# Memory\n\nauth_token: "my-secret-token-12345678901234567890"';
      const result = validateSubstrateContent(content, SubstrateFileType.MEMORY);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Generic Token"))).toBe(true);
    });

    it("rejects content with AWS credentials", () => {
      const content = "# Skills\n\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
      const result = validateSubstrateContent(content, SubstrateFileType.SKILLS);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("AWS Access Key ID"))).toBe(true);
    });

    it("rejects content with private keys", () => {
      const content = "# Security\n\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...";
      const result = validateSubstrateContent(content, SubstrateFileType.SECURITY);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Private Key"))).toBe(true);
    });

    it("rejects content with database connection strings", () => {
      const content = "# Memory\n\nDATABASE_URL=postgres://user:password@localhost:5432/mydb";
      const result = validateSubstrateContent(content, SubstrateFileType.MEMORY);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Database Connection String"))).toBe(true);
    });

    it("accepts content without secrets", () => {
      const content = "# Memory\n\nI learned about API key security today. Always use environment variables!";
      const result = validateSubstrateContent(content, SubstrateFileType.MEMORY);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("provides detailed error messages with line numbers", () => {
      const content = '# Plan\n\n## Tasks\n\napi_key: "abcdef1234567890abcdef1234567890abcdef12"';
      const result = validateSubstrateContent(content, SubstrateFileType.PLAN);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("line"))).toBe(true);
      expect(result.errors.some(e => e.includes("column"))).toBe(true);
    });

    it("redacts secrets in error messages", () => {
      const content = '# Memory\n\napi_key: "abcdef1234567890abcdef1234567890abcdef12"';
      const result = validateSubstrateContent(content, SubstrateFileType.MEMORY);

      expect(result.valid).toBe(false);
      // Should show partial match (last 4 chars visible)
      expect(result.errors[0]).toContain("ef12");
      // Should contain redaction asterisks
      expect(result.errors[0]).toContain("*");
      // Should NOT show full secret value
      expect(result.errors[0]).not.toContain("abcdef1234567890abcdef1234567890abcdef12");
    });
  });
});
