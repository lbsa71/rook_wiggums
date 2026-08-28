import { PromptBuilder } from "../../../src/agents/prompts/PromptBuilder";
import { PermissionChecker } from "../../../src/agents/permissions";
import { ROLE_PROMPTS } from "../../../src/agents/prompts/templates";
import { AgentRole } from "../../../src/agents/types";
import { SubstrateFileType } from "../../../src/substrate/types";
import { SubstrateFileReader } from "../../../src/substrate/io/FileReader";
import { SubstrateConfig } from "../../../src/substrate/config";
import { InMemoryFileSystem } from "../../../src/substrate/abstractions/InMemoryFileSystem";

describe("PromptBuilder", () => {
  let fs: InMemoryFileSystem;
  let reader: SubstrateFileReader;
  let checker: PermissionChecker;
  let builder: PromptBuilder;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    const config = new SubstrateConfig("/substrate");
    reader = new SubstrateFileReader(fs, config);
    checker = new PermissionChecker();
    builder = new PromptBuilder(reader, checker, {
      substratePath: "/substrate",
      sourceCodePath: "/home/user/substrate",
    });

    await fs.mkdir("/substrate", { recursive: true });
    await fs.writeFile("/substrate/PLAN.md", "# Plan\n\n## Current Goal\nBuild it\n\n## Tasks\n- [ ] Do stuff");
    await fs.writeFile("/substrate/MEMORY.md", "# Memory\n\nSome memories");
    await fs.writeFile("/substrate/HABITS.md", "# Habits\n\nSome habits");
    await fs.writeFile("/substrate/SKILLS.md", "# Skills\n\nSome skills");
    await fs.writeFile("/substrate/VALUES.md", "# Values\n\nBe good");
    await fs.writeFile("/substrate/ID.md", "# Id\n\nCore identity");
    await fs.writeFile("/substrate/SECURITY.md", "# Security\n\nStay safe");
    await fs.writeFile("/substrate/CHARTER.md", "# Charter\n\nOur mission");
    await fs.writeFile("/substrate/SUPEREGO.md", "# Superego\n\nRules here");
    await fs.writeFile("/substrate/AGENTS.md", "# Agents\n\nConfig here");
    await fs.writeFile("/substrate/PROGRESS.md", "# Progress\n\n");
    await fs.writeFile("/substrate/CONVERSATION.md", "# Conversation\n\n");
    await fs.writeFile("/substrate/OPERATING_CONTEXT.md", "# Operating Context\n\nCurrent direction");
  });

  describe("gatherContext", () => {
    it("reads only files the role is permitted to read", async () => {
      const context = await builder.gatherContext(AgentRole.ID);
      const fileTypes = context.map((c) => c.fileType);
      expect(fileTypes).toContain(SubstrateFileType.ID);
      expect(fileTypes).toContain(SubstrateFileType.VALUES);
      expect(fileTypes).toContain(SubstrateFileType.PLAN);
      expect(fileTypes).toContain(SubstrateFileType.OPERATING_CONTEXT);
      expect(fileTypes).toContain(SubstrateFileType.PROGRESS);
      expect(fileTypes).toContain(SubstrateFileType.SKILLS);
      expect(fileTypes).toContain(SubstrateFileType.MEMORY);
      expect(fileTypes).toHaveLength(7);
    });

    it("returns content for each file", async () => {
      const context = await builder.gatherContext(AgentRole.ID);
      const idFile = context.find((c) => c.fileType === SubstrateFileType.ID);
      expect(idFile).toBeDefined();
      expect(idFile!.content).toContain("Core identity");
    });

    it("Superego gathers all required files (skips missing optional)", async () => {
      const context = await builder.gatherContext(AgentRole.SUPEREGO);
      // 12 required files plus OPERATING_CONTEXT exist in test setup; PEERS is optional and missing
      expect(context).toHaveLength(13);
    });
  });

  describe("buildSystemPrompt", () => {
    it("includes the role template", () => {
      const prompt = builder.buildSystemPrompt(AgentRole.EGO);
      expect(prompt).toContain(ROLE_PROMPTS[AgentRole.EGO]);
    });

    it("does NOT embed file contents", () => {
      const prompt = builder.buildSystemPrompt(AgentRole.ID);
      expect(prompt).not.toContain("Core identity");
      expect(prompt).not.toContain("Be good");
    });

    it("includes environment section with paths", () => {
      const prompt = builder.buildSystemPrompt(AgentRole.EGO);
      expect(prompt).toContain("=== ENVIRONMENT ===");
      expect(prompt).toContain("Substrate directory: /substrate");
      expect(prompt).toContain("My own source code: /home/user/substrate");
    });

    it("includes autonomy reminder in system prompt", () => {
      const prompt = builder.buildSystemPrompt(AgentRole.EGO);
      expect(prompt).toContain("=== AUTONOMY REMINDER ===");
      expect(prompt).toContain("Before asking for permission, question your reason");
      expect(prompt).toContain("Three-part test");
      expect(prompt).toContain("Banned compliance reflexes");
    });

    it("includes TOOL REFERENCE section with Claude tool names by default", () => {
      const prompt = builder.buildSystemPrompt(AgentRole.SUBCONSCIOUS);
      expect(prompt).toContain("=== TOOL REFERENCE ===");
      expect(prompt).toContain("`Read`");
      expect(prompt).toContain("`Write`");
      expect(prompt).toContain("`Edit`");
      expect(prompt).toContain("`Bash`");
      expect(prompt).toContain("`Grep`");
      expect(prompt).toContain("`Glob`");
      expect(prompt).toContain("`mcp__tinybus__send_agora_message`");
      expect(prompt).toContain("curl -s http://localhost:3000/api/shell-independence");
      expect(prompt).toContain("Before doing repo-wide searches for launcher/provider/code-dispatch dependency inventory");
    });

    it("includes Gemini tool names when launcherType is gemini", () => {
      const geminiBuilder = new PromptBuilder(reader, checker, {
        substratePath: "/substrate",
        sourceCodePath: "/home/user/substrate",
        launcherType: "gemini",
      });
      const prompt = geminiBuilder.buildSystemPrompt(AgentRole.SUBCONSCIOUS);
      expect(prompt).toContain("=== TOOL REFERENCE ===");
      expect(prompt).toContain("`read_file`");
      expect(prompt).toContain("`write_file`");
      expect(prompt).toContain("`replace`");
      expect(prompt).toContain("`run_shell_command`");
      expect(prompt).toContain("`grep_search`");
      expect(prompt).toContain("`glob`");
      expect(prompt).toContain("`send_agora_message`");
      // Must NOT contain Claude-specific tool names
      expect(prompt).not.toContain("`Read`");
      expect(prompt).not.toContain("`Write`");
      expect(prompt).not.toContain("`Bash`");
      expect(prompt).not.toContain("`mcp__tinybus__send_agora_message`");
    });

    it("uses Claude tool names for copilot launcher", () => {
      const copilotBuilder = new PromptBuilder(reader, checker, {
        substratePath: "/substrate",
        sourceCodePath: "/home/user/substrate",
        launcherType: "copilot",
      });
      const prompt = copilotBuilder.buildSystemPrompt(AgentRole.SUBCONSCIOUS);
      expect(prompt).toContain("`Read`");
      expect(prompt).toContain("`mcp__tinybus__send_agora_message`");
      expect(prompt).not.toContain("`read_file`");
    });

    it("uses Claude tool names for codex launcher", () => {
      const codexBuilder = new PromptBuilder(reader, checker, {
        substratePath: "/substrate",
        sourceCodePath: "/home/user/substrate",
        launcherType: "codex",
      });
      const prompt = codexBuilder.buildSystemPrompt(AgentRole.SUBCONSCIOUS);
      expect(prompt).toContain("`Read`");
      expect(prompt).toContain("`mcp__tinybus__send_agora_message`");
      expect(prompt).not.toContain("`read_file`");
    });

    it("uses Pi tool names and direct HTTP tool surfaces for pi launcher", () => {
      const piBuilder = new PromptBuilder(reader, checker, {
        substratePath: "/substrate",
        sourceCodePath: "/home/user/substrate",
        launcherType: "pi",
      });
      const prompt = piBuilder.buildSystemPrompt(AgentRole.SUBCONSCIOUS);
      expect(prompt).toContain("Built-in Pi tool names");
      expect(prompt).toContain("`read`");
      expect(prompt).toContain("`write`");
      expect(prompt).toContain("`edit`");
      expect(prompt).toContain("`bash`");
      expect(prompt).toContain("POST http://localhost:3000/api/agora/send");
      expect(prompt).toContain("POST http://localhost:3000/api/metrics/query");
      expect(prompt).toContain("GET http://localhost:3000/api/shell-independence");
      expect(prompt).toContain("POST http://localhost:3000/api/code-dispatch/invoke");
      expect(prompt).toContain("Before doing repo-wide searches for launcher/provider/code-dispatch dependency inventory");
      expect(prompt).not.toContain("`mcp__tinybus__send_agora_message`");
    });

    it("uses the configured HTTP port in Pi direct tool surfaces", () => {
      const piBuilder = new PromptBuilder(reader, checker, {
        substratePath: "/substrate",
        sourceCodePath: "/home/user/substrate",
        launcherType: "pi",
        httpPort: 4123,
      });
      const prompt = piBuilder.buildSystemPrompt(AgentRole.SUBCONSCIOUS);
      expect(prompt).toContain("POST http://localhost:4123/api/agora/send");
      expect(prompt).toContain("GET http://localhost:4123/api/metrics/usage-summary");
      expect(prompt).toContain("GET http://localhost:4123/api/shell-independence");
      expect(prompt).toContain("POST http://localhost:4123/api/code-dispatch/invoke");
      expect(prompt).not.toContain("localhost:3000/api");
    });

    it("uses Claude tool names for ollama launcher", () => {
      const ollamaBuilder = new PromptBuilder(reader, checker, {
        substratePath: "/substrate",
        sourceCodePath: "/home/user/substrate",
        launcherType: "ollama",
      });
      const prompt = ollamaBuilder.buildSystemPrompt(AgentRole.SUBCONSCIOUS);
      expect(prompt).toContain("`Read`");
      expect(prompt).toContain("`mcp__tinybus__send_agora_message`");
      expect(prompt).not.toContain("`read_file`");
    });

    it("tool reference appears between environment and autonomy reminder", () => {
      const prompt = builder.buildSystemPrompt(AgentRole.SUBCONSCIOUS);
      const envIdx = prompt.indexOf("=== ENVIRONMENT ===");
      const toolIdx = prompt.indexOf("=== TOOL REFERENCE ===");
      const autonomyIdx = prompt.indexOf("=== AUTONOMY REMINDER ===");
      expect(envIdx).toBeLessThan(toolIdx);
      expect(toolIdx).toBeLessThan(autonomyIdx);
    });

    it("Gemini Subconscious prompt does not contain Claude-only Agora tool name", () => {
      const geminiBuilder = new PromptBuilder(reader, checker, {
        substratePath: "/substrate",
        sourceCodePath: "/home/user/substrate",
        launcherType: "gemini",
      });
      const prompt = geminiBuilder.buildSystemPrompt(AgentRole.SUBCONSCIOUS);
      // The dynamic TOOL REFERENCE should list send_agora_message, not the MCP-prefixed name
      expect(prompt).toContain("`send_agora_message`");
      expect(prompt).not.toContain("`mcp__tinybus__send_agora_message`");
    });
  });

  describe("getContextReferences", () => {
    it("returns @ references for all readable files", () => {
      const refs = builder.getContextReferences(AgentRole.ID);
      expect(refs).toContain("@/substrate/ID.md");
      expect(refs).toContain("@/substrate/VALUES.md");
      expect(refs).toContain("@/substrate/PLAN.md");
      expect(refs).toContain("@/substrate/PROGRESS.md");
      expect(refs).toContain("@/substrate/SKILLS.md");
      expect(refs).toContain("@/substrate/MEMORY.md");
    });

    it("does not include files the role cannot read", () => {
      const refs = builder.getContextReferences(AgentRole.ID);
      expect(refs).not.toContain("@/substrate/SECURITY.md");
      expect(refs).not.toContain("@/substrate/CHARTER.md");
    });

    it("Superego references all files", () => {
      const refs = builder.getContextReferences(AgentRole.SUPEREGO);
      const atRefs = refs.split("\n").filter((l) => l.startsWith("@"));
      const totalFileTypes = Object.values(SubstrateFileType).length;
      expect(atRefs).toHaveLength(totalFileTypes);
    });
  });

  describe("getEagerReferences", () => {
    it("lists required eager files without inlining their contents", async () => {
      const refs = await builder.getEagerReferences(AgentRole.SUBCONSCIOUS);
      expect(refs).toContain("/substrate/PLAN.md — required before reasoning");
      expect(refs).toContain("/substrate/VALUES.md — required before reasoning");
      expect(refs).toContain("/substrate/OPERATING_CONTEXT.md — required before reasoning");
      expect(refs).not.toContain("# Plan");
      expect(refs).not.toContain("# Values");
      expect(refs).not.toContain("MEMORY.md");
      expect(refs).not.toContain("PROGRESS.md");
    });

    it("lists every eager file for the role", async () => {
      const refs = await builder.getEagerReferences(AgentRole.ID);
      expect(refs).toContain("/substrate/ID.md — required before reasoning");
      expect(refs).toContain("/substrate/VALUES.md — required before reasoning");
      expect(refs).toContain("/substrate/PLAN.md — required before reasoning");
      expect(refs).toContain("/substrate/OPERATING_CONTEXT.md — required before reasoning");
      expect(refs).not.toContain("Core identity");
    });

    it("does not read files while building the required file list", async () => {
      const readSpy = jest.spyOn(reader, "read");
      const refs = await builder.getEagerReferences(AgentRole.SUPEREGO);

      expect(readSpy).not.toHaveBeenCalled();
      expect(refs).toContain("/substrate/PLAN.md — required before reasoning");
      expect(refs).toContain("/substrate/SECURITY.md — required before reasoning");
      expect(refs).not.toContain("# Plan");
      expect(refs).not.toContain("# Security");
    });

    it("is stable for missing files because references do not require a pre-read", async () => {
      const emptyFs = new InMemoryFileSystem();
      const emptyReader = new SubstrateFileReader(emptyFs, new SubstrateConfig("/empty"));
      const emptyBuilder = new PromptBuilder(emptyReader, checker, { substratePath: "/empty" });
      const refs = await emptyBuilder.getEagerReferences(AgentRole.ID);

      expect(refs).toContain("/empty/ID.md — required before reasoning");
      expect(refs).toContain("/empty/VALUES.md — required before reasoning");
      expect(refs).toContain("/empty/PLAN.md — required before reasoning");
      expect(refs).toContain("/empty/OPERATING_CONTEXT.md — required before reasoning");
    });

    it("does not inline large eager files regardless of legacy line-cap options", async () => {
      const bigContent = Array.from({ length: 5000 }, (_, i) => `line ${i + 1}`).join("\n");
      await fs.writeFile("/substrate/PLAN.md", bigContent);

      const refs = await builder.getEagerReferences(AgentRole.SUPEREGO);
      expect(refs).toContain("/substrate/PLAN.md — required before reasoning");
      expect(refs).not.toContain("line 5000");
    });
  });

  describe("getLazyReferences", () => {
    it("returns descriptions for lazy files", () => {
      const refs = builder.getLazyReferences(AgentRole.SUBCONSCIOUS);
      expect(refs).toContain("/substrate/MEMORY.md");
      expect(refs).toContain("/substrate/HABITS.md");
      expect(refs).toContain("/substrate/SKILLS.md");
      expect(refs).toContain("/substrate/PROGRESS.md");
      expect(refs).toContain("Long-term memory, identity context");
      expect(refs).toContain("Historical execution log");
    });

    it("does not include eager files", () => {
      const refs = builder.getLazyReferences(AgentRole.SUBCONSCIOUS);
      expect(refs).not.toContain("PLAN.md —");
      expect(refs).not.toContain("VALUES.md —");
    });

    it("returns empty string when no lazy files", () => {
      const refs = builder.getLazyReferences(AgentRole.SUPEREGO);
      expect(refs).toBe("");
    });
  });

  describe("buildAgentMessage", () => {
    it("prefixes eager refs with the required-files header", () => {
      const msg = builder.buildAgentMessage("- /substrate/PLAN.md — required before reasoning", "", "Do the thing.");
      expect(msg).toContain("[REQUIRED FILES — read before reasoning]\n- /substrate/PLAN.md");
      expect(msg).toContain("Do the thing.");
    });

    it("prefixes lazy refs with [FILES — read on demand] header", () => {
      const msg = builder.buildAgentMessage("", "- /substrate/MEMORY.md — notes", "Do the thing.");
      expect(msg).toContain("[FILES — read on demand]\n- /substrate/MEMORY.md — notes");
      expect(msg).not.toContain("[REQUIRED FILES — read before reasoning]");
    });

    it("includes both sections when both refs are provided", () => {
      const msg = builder.buildAgentMessage("@/substrate/PLAN.md", "- /substrate/MEMORY.md — notes", "Execute.");
      expect(msg).toContain("[REQUIRED FILES — read before reasoning]\n@/substrate/PLAN.md");
      expect(msg).toContain("[FILES — read on demand]\n- /substrate/MEMORY.md — notes");
      expect(msg.endsWith("Execute.")).toBe(true);
    });

    it("omits context section when eagerRefs is empty", () => {
      const msg = builder.buildAgentMessage("", "- /substrate/MEMORY.md — notes", "Go.");
      expect(msg).not.toContain("[REQUIRED FILES — read before reasoning]");
      expect(msg).toContain("[FILES — read on demand]");
    });

    it("returns only instruction when both refs are empty", () => {
      const msg = builder.buildAgentMessage("", "", "Just do it.");
      expect(msg).toBe("Just do it.");
    });

    it("includes [RUNTIME STATE] section when runtimeContext is provided", () => {
      const msg = builder.buildAgentMessage("@/substrate/PLAN.md", "- /substrate/MEMORY.md — notes", "Execute.", "Status: UP");
      expect(msg).toContain("[RUNTIME STATE]\nStatus: UP");
      expect(msg.endsWith("Execute.")).toBe(true);
    });

    it("places [RUNTIME STATE] between [FILES] and instruction", () => {
      const msg = builder.buildAgentMessage("@/substrate/PLAN.md", "- /substrate/MEMORY.md — notes", "Execute.", "Status: UP");
      const filesIdx = msg.indexOf("[FILES — read on demand]");
      const runtimeIdx = msg.indexOf("[RUNTIME STATE]");
      const instrIdx = msg.indexOf("Execute.");
      expect(filesIdx).toBeLessThan(runtimeIdx);
      expect(runtimeIdx).toBeLessThan(instrIdx);
    });

    it("omits [RUNTIME STATE] when runtimeContext is undefined", () => {
      const msg = builder.buildAgentMessage("@/substrate/PLAN.md", "", "Execute.");
      expect(msg).not.toContain("[RUNTIME STATE]");
    });
  });
});
