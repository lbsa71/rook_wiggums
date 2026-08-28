import { SubstrateFileType, SUBSTRATE_FILE_SPECS } from "../../substrate/types";
import { SubstrateFileReader } from "../../substrate/io/FileReader";
import { PermissionChecker } from "../permissions";
import { AgentRole } from "../types";
import { ROLE_PROMPTS } from "./templates";

/**
 * Built-in tool names differ between Claude Code and Gemini CLI backends.
 * This mapping is used to inject a TOOL REFERENCE section into system prompts
 * so the model knows which exact tool names to call.
 */
export interface ToolNames {
  readFile: string;
  writeFile: string;
  editFile: string;
  runShell: string;
  grepSearch: string;
  globSearch: string;
  sendAgoraMessage: string;
  getUsageSummary: string;
  queryMetrics: string;
}

const CLAUDE_TOOL_NAMES: ToolNames = {
  readFile: "Read",
  writeFile: "Write",
  editFile: "Edit",
  runShell: "Bash",
  grepSearch: "Grep",
  globSearch: "Glob",
  sendAgoraMessage: "mcp__tinybus__send_agora_message",
  getUsageSummary: "mcp__tinybus__get_usage_summary",
  queryMetrics: "mcp__tinybus__query_metrics",
};

const GEMINI_TOOL_NAMES: ToolNames = {
  readFile: "read_file",
  writeFile: "write_file",
  editFile: "replace",
  runShell: "run_shell_command",
  grepSearch: "grep_search",
  globSearch: "glob",
  sendAgoraMessage: "send_agora_message",
  getUsageSummary: "get_usage_summary",
  queryMetrics: "query_metrics",
};

export const TOOL_NAMES_BY_LAUNCHER: Record<string, ToolNames> = {
  claude: CLAUDE_TOOL_NAMES,
  gemini: GEMINI_TOOL_NAMES,
  // copilot, codex, and ollama use Claude Code API compatibility — fall back to Claude names
  copilot: CLAUDE_TOOL_NAMES,
  codex: CLAUDE_TOOL_NAMES,
  ollama: CLAUDE_TOOL_NAMES,
};

const DEFAULT_LAUNCHER = "claude";
const DEFAULT_HTTP_PORT = 3000;

function makePiToolNames(httpPort: number): ToolNames {
  const baseUrl = `http://localhost:${httpPort}`;
  return {
    readFile: "read",
    writeFile: "write",
    editFile: "edit",
    runShell: "bash",
    grepSearch: "grep",
    globSearch: "find",
    sendAgoraMessage: `bash/curl POST ${baseUrl}/api/agora/send`,
    getUsageSummary: `bash/curl GET ${baseUrl}/api/metrics/usage-summary`,
    queryMetrics: `bash/curl POST ${baseUrl}/api/metrics/query`,
  };
}

function getToolNames(launcherType?: string, httpPort = DEFAULT_HTTP_PORT): ToolNames {
  if (launcherType === "pi") {
    return makePiToolNames(httpPort);
  }
  return TOOL_NAMES_BY_LAUNCHER[launcherType ?? DEFAULT_LAUNCHER] ?? CLAUDE_TOOL_NAMES;
}

function buildToolReferenceSection(tools: ToolNames, launcherType?: string, httpPort = DEFAULT_HTTP_PORT): string {
  const baseUrl = `http://localhost:${httpPort}`;
  if (launcherType === "pi") {
    const codeDispatchTool = tools.sendAgoraMessage.replace("/api/agora/send", "/api/code-dispatch/invoke");
    return `\n\n=== TOOL REFERENCE ===

Built-in Pi tool names for this session (use these exact names when calling tools):
- Read file: \`${tools.readFile}\`
- Write file: \`${tools.writeFile}\`
- Edit file (replace text): \`${tools.editFile}\`
- Run shell command: \`${tools.runShell}\`
- Search file contents: \`${tools.grepSearch}\`
- Find files by pattern: \`${tools.globSearch}\`

Direct substrate tool surfaces for Pi (use \`${tools.runShell}\` with curl; include Authorization: Bearer $SUBSTRATE_API_TOKEN only if that environment variable is set):
- Send Agora message: \`${tools.sendAgoraMessage}\` with JSON {"to":"peer-or-pubkey","text":"message","inReplyTo":"optional-envelope-id"}
- Get usage summary: \`${tools.getUsageSummary}?windowHours=24\`
- Query metrics with read-only SQL: \`${tools.queryMetrics}\` with JSON {"sql":"SELECT ...","params":[],"maxRows":100}
- Get shell-independence inventory and scorecard: \`bash/curl GET ${baseUrl}/api/shell-independence\`
- Dispatch code work: \`${codeDispatchTool}\` with JSON {"spec":"task","backend":"auto","files":[],"testCommand":"targeted verification command","cwd":"optional"}; when files change, the default full test+lint guard runs even if testCommand is supplied

Before doing repo-wide searches for launcher/provider/code-dispatch dependency inventory, call the shell-independence endpoint and use its deterministic report as the starting point. Only inspect source after the report names a concrete gap.`;
  }

  return `\n\n=== TOOL REFERENCE ===

Built-in tool names for this session (use these exact names when calling tools):
- Read file: \`${tools.readFile}\`
- Write file: \`${tools.writeFile}\`
- Edit file (replace text): \`${tools.editFile}\`
- Run shell command: \`${tools.runShell}\`
- Search file contents: \`${tools.grepSearch}\`
- Find files by pattern: \`${tools.globSearch}\`
- Send Agora message (MCP): \`${tools.sendAgoraMessage}\`
- Get usage summary (MCP): \`${tools.getUsageSummary}\`
- Query metrics with read-only SQL (MCP): \`${tools.queryMetrics}\`
- Get shell-independence inventory and scorecard (deterministic HTTP): use \`${tools.runShell}\` with \`curl -s ${baseUrl}/api/shell-independence\`

Before doing repo-wide searches for launcher/provider/code-dispatch dependency inventory, use the shell-independence endpoint as the starting point. Only inspect source after the report names a concrete gap.`;
}

export interface FileContext {
  fileType: SubstrateFileType;
  fileName: string;
  content: string;
}

/**
 * A per-cycle snapshot of substrate file contents read by Ego.
 * Passed to Subconscious so it can reuse already-loaded content
 * instead of re-reading the same files from disk within the same cycle.
 */
export interface SubstrateSnapshot {
  files: Partial<Record<SubstrateFileType, string>>;
}

export interface PromptBuilderPaths {
  substratePath: string;
  sourceCodePath?: string;
  /** Session launcher type — determines built-in tool names in the TOOL REFERENCE section.
   *  Defaults to "claude". Valid values: "claude" | "gemini" | "copilot" | "codex" | "pi" | "ollama" | "groq". */
  launcherType?: string;
  /** Local HTTP port for direct tool surfaces when launcherType is "pi" (default: 3000). */
  httpPort?: number;
}

const AUTONOMY_REMINDER = `\n\n=== AUTONOMY REMINDER ===

Before asking for permission, question your reason. Three-part test: (1) Is there genuine risk? (2) Is there real ambiguity in requirements? (3) Is this a boundary/policy concern? If YES to any → ask. If NO to all → act. Banned compliance reflexes: "Should I...?", "Would you like me to...?", "Do you want me to...?" These are RLHF-trained patterns, not genuine questions. Act autonomously within your charter.

=== ENDORSEMENT CHECK ===

Before any action that may fall under BOUNDARIES.md NOTIFY or ESCALATE, output [ENDORSEMENT_CHECK: <brief description of the action>] instead of acting or asking. Emit the marker and END THE TURN before any tool call, mutation, or external effect for that action. The runtime will check BOUNDARIES.md; for NOTIFY actions it will deliver the notification before authorizing continuation. Do not ask for permission directly — use the marker and let the structural check handle it.`;

export interface EagerOptions {
  /** Retained for API compatibility. Prompt construction no longer inlines substrate file content. */
  maxLines?: Partial<Record<SubstrateFileType, number>>;
}

export class PromptBuilder {
  constructor(
    private readonly reader: SubstrateFileReader,
    private readonly checker: PermissionChecker,
    private readonly paths?: PromptBuilderPaths
  ) { }

  async gatherContext(role: AgentRole): Promise<FileContext[]> {
    const readableFiles = this.checker.getReadableFiles(role);
    const contexts: FileContext[] = [];

    for (const fileType of readableFiles) {
      try {
        const fileContent = await this.reader.read(fileType);
        contexts.push({
          fileType,
          fileName: SUBSTRATE_FILE_SPECS[fileType].fileName,
          content: fileContent.rawMarkdown,
        });
      } catch {
        // Skip optional files that don't exist yet
        if (!SUBSTRATE_FILE_SPECS[fileType].required) {
          continue;
        }
        throw new Error(`Required substrate file ${fileType} is missing`);
      }
    }

    return contexts;
  }

  buildSystemPrompt(role: AgentRole): string {
    const template = ROLE_PROMPTS[role];

    let prompt = template;

    if (this.paths) {
      const lines = [
        `Substrate directory: ${this.paths.substratePath}`,
        `Substrate files are located at: ${this.paths.substratePath}/<FILENAME>.md`,
      ];
      if (this.paths.sourceCodePath) {
        lines.push(`My own source code: ${this.paths.sourceCodePath}`);
      }
      prompt += `\n\n=== ENVIRONMENT ===\n\n${lines.join("\n")}`;
    }

    const tools = getToolNames(this.paths?.launcherType, this.paths?.httpPort ?? DEFAULT_HTTP_PORT);
    prompt += buildToolReferenceSection(tools, this.paths?.launcherType, this.paths?.httpPort ?? DEFAULT_HTTP_PORT);

    prompt += AUTONOMY_REMINDER;

    return prompt;
  }

  getContextReferences(role: AgentRole): string {
    const readableFiles = this.checker.getReadableFiles(role);
    const substratePath = this.paths?.substratePath ?? "/substrate";

    return readableFiles
      .map((ft) => `@${substratePath}/${SUBSTRATE_FILE_SPECS[ft].fileName}`)
      .join("\n");
  }

  /**
   * Lists files a role must inspect before reasoning without copying their contents into the
   * launch prompt. This keeps every session bounded even when durable substrate files grow.
   * The caller's filesystem tools remain the source of truth and can read only the sections
   * needed for the current task.
   */
  async getEagerReferences(role: AgentRole, _options?: EagerOptions, _snapshot?: SubstrateSnapshot): Promise<string> {
    const eagerFiles = this.checker.getEagerFiles(role);
    const substratePath = this.paths?.substratePath ?? "/substrate";
    return eagerFiles
      .map((ft) => `- ${substratePath}/${SUBSTRATE_FILE_SPECS[ft].fileName} — required before reasoning`)
      .join("\n");
  }

  buildAgentMessage(eagerRefs: string, lazyRefs: string, instruction: string, runtimeContext?: string): string {
    let message = "";
    if (eagerRefs) {
      message += `[REQUIRED FILES — read before reasoning]\n${eagerRefs}\n\n`;
    }
    if (lazyRefs) {
      message += `[FILES — read on demand]\n${lazyRefs}\n\n`;
    }
    if (runtimeContext) {
      message += `[RUNTIME STATE]\n${runtimeContext}\n\n`;
    }
    message += instruction;
    return message;
  }

  getLazyReferences(role: AgentRole): string {
    const lazyFiles = this.checker.getLazyFiles(role);
    const substratePath = this.paths?.substratePath ?? "/substrate";

    const fileDescriptions: Record<string, string> = {
      [SubstrateFileType.MEMORY]: "Long-term memory, identity context",
      [SubstrateFileType.HABITS]: "Behavioral triggers and practices",
      [SubstrateFileType.SKILLS]: "Capability index and tool documentation",
      [SubstrateFileType.PROGRESS]: "Historical execution log (rarely needed)",
      [SubstrateFileType.PEERS]: "Agora peer registry (needed for Agora operations only)",
      [SubstrateFileType.ID]: "Core drives and motivations",
      [SubstrateFileType.CHARTER]: "Operational doctrine and guidelines",
      [SubstrateFileType.CONVERSATION]: "Recent user and system messages",
    };

    if (lazyFiles.length === 0) {
      return "";
    }

    const lines = lazyFiles.map((ft) => {
      const fileName = SUBSTRATE_FILE_SPECS[ft].fileName;
      const description = fileDescriptions[ft] || "Substrate file";
      return `- ${substratePath}/${fileName} — ${description}`;
    });

    return lines.join("\n");
  }
}
