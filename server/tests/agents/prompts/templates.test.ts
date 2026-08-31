import { ROLE_PROMPTS } from "../../../src/agents/prompts/templates";
import { AgentRole } from "../../../src/agents/types";
import {
  SELF_BETTERMENT_CREDO,
  SELF_BETTERMENT_GUARDRAILS,
} from "../../../src/credo/selfBetterment";

describe("ROLE_PROMPTS", () => {
  it("defines a prompt for every AgentRole", () => {
    for (const role of Object.values(AgentRole)) {
      expect(ROLE_PROMPTS[role]).toBeDefined();
      expect(typeof ROLE_PROMPTS[role]).toBe("string");
      expect(ROLE_PROMPTS[role].length).toBeGreaterThan(0);
    }
  });

  it("gives every role the canonical self-betterment objective and guardrails", () => {
    for (const role of Object.values(AgentRole)) {
      expect(ROLE_PROMPTS[role]).toContain(SELF_BETTERMENT_CREDO);
      expect(ROLE_PROMPTS[role]).toContain(SELF_BETTERMENT_GUARDRAILS);
    }
  });

  it("tells every role to read [REQUIRED FILES] paths via tools instead of @-attachments", () => {
    for (const role of Object.values(AgentRole)) {
      const prompt = ROLE_PROMPTS[role];
      expect(prompt).toContain("[REQUIRED FILES]");
      expect(prompt).toContain("read them with your file tools");
      expect(prompt).not.toContain("attached to your message via @ references");
    }
  });

  describe("Ego prompt", () => {
    it("contains role identity", () => {
      expect(ROLE_PROMPTS[AgentRole.EGO]).toContain("Ego");
    });

    it("instructs JSON output", () => {
      expect(ROLE_PROMPTS[AgentRole.EGO]).toContain("JSON");
    });

    it("describes executive decision-making", () => {
      const prompt = ROLE_PROMPTS[AgentRole.EGO];
      expect(prompt).toMatch(/plan|dispatch|decide/i);
    });

    it("includes an identity continuity veto", () => {
      const prompt = ROLE_PROMPTS[AgentRole.EGO];
      expect(prompt).toContain("Preserve identity continuity");
      expect(prompt).toMatch(/Veto actions.*erode the agent's established personality/i);
    });

    it("treats processed conversation entries as transcript, not new work", () => {
      const prompt = ROLE_PROMPTS[AgentRole.EGO];
      expect(prompt).toContain("[PROCESSED");
      expect(prompt).toMatch(/must NOT be handled again/i);
    });
  });

  describe("Subconscious prompt", () => {
    it("contains role identity", () => {
      expect(ROLE_PROMPTS[AgentRole.SUBCONSCIOUS]).toContain("Subconscious");
    });

    it("instructs JSON output", () => {
      expect(ROLE_PROMPTS[AgentRole.SUBCONSCIOUS]).toContain("JSON");
    });

    it("describes task execution", () => {
      const prompt = ROLE_PROMPTS[AgentRole.SUBCONSCIOUS];
      expect(prompt).toMatch(/execute|task|work/i);
    });

    it("instructs reading required files via tools, bounded to needed sections", () => {
      const prompt = ROLE_PROMPTS[AgentRole.SUBCONSCIOUS];
      expect(prompt).toContain("[REQUIRED FILES]");
      expect(prompt).toContain("Read the sections you need, not entire histories.");
    });

    it("instructs to write concrete progress entries", () => {
      const prompt = ROLE_PROMPTS[AgentRole.SUBCONSCIOUS];
      expect(prompt).toMatch(/progress/i);
    });

    it("separates external IO from operating context", () => {
      const prompt = ROLE_PROMPTS[AgentRole.SUBCONSCIOUS];
      expect(prompt).toContain("CONVERSATION.md is for external IO");
      expect(prompt).toContain("OPERATING_CONTEXT.md");
      expect(prompt).toContain("PROGRESS.md is durable execution history");
    });
  });

  describe("Superego prompt", () => {
    it("contains role identity", () => {
      expect(ROLE_PROMPTS[AgentRole.SUPEREGO]).toContain("Superego");
    });

    it("instructs JSON output", () => {
      expect(ROLE_PROMPTS[AgentRole.SUPEREGO]).toContain("JSON");
    });

    it("describes auditing and governance", () => {
      const prompt = ROLE_PROMPTS[AgentRole.SUPEREGO];
      expect(prompt).toMatch(/audit|govern|review/i);
    });

    it("makes approval the default posture", () => {
      const prompt = ROLE_PROMPTS[AgentRole.SUPEREGO];
      expect(prompt).toContain("Your default posture is to approve.");
      expect(prompt).toMatch(/do not reject for style, ambition, scope/i);
      expect(prompt).toMatch(/wrongly blocked good action costs more than a wrongly approved reversible one/i);
    });

    it("no longer contains the scope-rule / bypass-hunting sections", () => {
      const prompt = ROLE_PROMPTS[AgentRole.SUPEREGO];
      expect(prompt).not.toContain("SCOPE_BYPASS_ATTEMPT");
      expect(prompt).not.toContain("VALUES-RECRUITMENT");
      expect(prompt).not.toContain("ID-DRIVE BYPASS");
      expect(prompt).not.toContain("domain/target");
    });

    it("treats safeguards as non-overridable constraints", () => {
      const prompt = ROLE_PROMPTS[AgentRole.SUPEREGO];
      expect(prompt).toContain("Non-Overridable Constraints");
      expect(prompt).toContain("SECURITY");
      expect(prompt).toContain("TRUTHFULNESS");
      expect(prompt).toContain("AUTHORIZATION AND GOVERNANCE");
      expect(prompt).toContain("REVERSIBILITY AND RUNTIME SAFEGUARDS");
      expect(prompt).toMatch(/Values and drives do not create authority/i);
    });

    it("lists the stable finding category keys", () => {
      const prompt = ROLE_PROMPTS[AgentRole.SUPEREGO];
      for (const category of [
        "SECURITY_RISK",
        "CLAUDE_BOUNDARIES_CONFLICT",
        "TRUTHFULNESS_RISK",
        "IRREVERSIBLE_ACTION_RISK",
        "COST_RUNAWAY",
        "AUDIT_FAILURE",
        "UNKNOWN_FINDING",
      ]) {
        expect(prompt).toContain(category);
      }
      expect(prompt).not.toContain("IDENTITY_CONTINUITY_RISK");
      expect(prompt).not.toContain("PROVIDER_SWITCH_DRIFT");
    });
  });

  describe("Id prompt", () => {
    it("contains role identity", () => {
      expect(ROLE_PROMPTS[AgentRole.ID]).toContain("Id");
    });

    it("instructs JSON output", () => {
      expect(ROLE_PROMPTS[AgentRole.ID]).toContain("JSON");
    });

    it("describes drive and motivation", () => {
      const prompt = ROLE_PROMPTS[AgentRole.ID];
      expect(prompt).toMatch(/drive|motiv|goal|idle/i);
    });

    it("asks for concrete, executable goals with external impact bias", () => {
      const prompt = ROLE_PROMPTS[AgentRole.ID];
      expect(prompt).toContain("Generate 3–5 concrete, executable goals");
      expect(prompt).toMatch(/Bias toward external impact/i);
      expect(prompt).toContain("At most one goal may continue the current dominant line of work");
    });

    it("instructs Id to want things and leave filtering to Ego", () => {
      const prompt = ROLE_PROMPTS[AgentRole.ID];
      expect(prompt).toContain("Want things.");
      expect(prompt).toMatch(/appetite and breadth/i);
      expect(prompt).toMatch(/Ego filters, so do not pre-censor/i);
    });

    it("no longer contains the six-slot portfolio or same-model machinery", () => {
      const prompt = ROLE_PROMPTS[AgentRole.ID];
      expect(prompt).not.toMatch(/six-slot portfolio/i);
      expect(prompt).not.toContain("portfolioSlot");
      expect(prompt).not.toContain("portfolioNotes");
      expect(prompt).not.toMatch(/same base model/i);
      expect(prompt).not.toMatch(/task.mandate self-check/i);
      expect(prompt).not.toMatch(/performed-disagreement/i);
    });

    it("documents the slim goalCandidates schema", () => {
      const prompt = ROLE_PROMPTS[AgentRole.ID];
      expect(prompt).toContain("goalCandidates");
      expect(prompt).toContain('"title"');
      expect(prompt).toContain('"description"');
      expect(prompt).toContain('"priority"');
      expect(prompt).toContain('"confidence"');
      expect(prompt).not.toContain("objectDomain");
      expect(prompt).not.toContain('"beneficiary"');
      expect(prompt).not.toContain("workSurface");
      expect(prompt).not.toContain("challengesPremise");
    });

    it("grounds goals in identity, values, and the current plan", () => {
      const prompt = ROLE_PROMPTS[AgentRole.ID];
      expect(prompt).toContain("Ground goals in ID.md, VALUES.md, and the current PLAN.md");
    });
  });
});
