import { getTemplate } from "../../../src/substrate/templates/index";
import { SubstrateFileType } from "../../../src/substrate/types";
import { validateSubstrateContent } from "../../../src/substrate/validation/validators";
import {
  SELF_BETTERMENT_CREDO,
  SELF_BETTERMENT_GUARDRAILS,
} from "../../../src/credo/selfBetterment";

describe("templates", () => {
  it("has a template for every SubstrateFileType", () => {
    for (const type of Object.values(SubstrateFileType)) {
      const template = getTemplate(type);
      expect(template).toBeTruthy();
      expect(typeof template).toBe("string");
    }
  });

  it("every template passes its own validator", () => {
    for (const type of Object.values(SubstrateFileType)) {
      const template = getTemplate(type);
      const result = validateSubstrateContent(template, type);
      expect(result.valid).toBe(true);
      if (!result.valid) {
        // Extra debug info if test fails
        console.log(`Template ${type} failed validation:`, result.errors);
      }
    }
  });

  it("each template starts with a # heading", () => {
    for (const type of Object.values(SubstrateFileType)) {
      const template = getTemplate(type);
      expect(template.trimStart().startsWith("# ")).toBe(true);
    }
  });

  it("PLAN template has bootstrapping tasks", () => {
    const plan = getTemplate(SubstrateFileType.PLAN);
    expect(plan).toContain("## Tasks");
    expect(plan).toContain("- [ ]");
  });

  it("AGENTS template has operational instructions", () => {
    const agents = getTemplate(SubstrateFileType.AGENTS);
    expect(agents).toMatch(/substrate|PLAN|PROGRESS/i);
  });

  it("wires the canonical credo into every doctrine-bearing template", () => {
    const doctrineFiles = [
      SubstrateFileType.PLAN,
      SubstrateFileType.MEMORY,
      SubstrateFileType.HABITS,
      SubstrateFileType.SKILLS,
      SubstrateFileType.VALUES,
      SubstrateFileType.ID,
      SubstrateFileType.CHARTER,
      SubstrateFileType.SUPEREGO,
      SubstrateFileType.AGENTS,
    ];

    for (const fileType of doctrineFiles) {
      const template = getTemplate(fileType);
      expect(template).toContain(SELF_BETTERMENT_CREDO);
      expect(template).toContain(SELF_BETTERMENT_GUARDRAILS);
    }
  });
});
