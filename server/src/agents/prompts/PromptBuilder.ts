import { SubstrateFileType, SUBSTRATE_FILE_SPECS } from "../../substrate/types";
import { SubstrateFileReader } from "../../substrate/io/FileReader";
import { PermissionChecker } from "../permissions";
import { AgentRole } from "../types";
import { ROLE_PROMPTS } from "./templates";

export interface FileContext {
  fileType: SubstrateFileType;
  fileName: string;
  content: string;
}

export interface PromptBuilderPaths {
  substratePath: string;
  sourceCodePath?: string;
  /**
   * When set to "gemini", the system prompt is prefixed with a Gemini tool-name
   * mapping note so the model uses the correct tool names (e.g. `read_file`
   * instead of `Read`, `run_shell_command` instead of `Bash`).
   *
   * Gemini CLI ↔ Claude Code tool-name mapping:
   *   read_file          ← Read
   *   write_file         ← Write
   *   replace            ← Edit  (params: old_string / new_string — compatible)
   *   run_shell_command  ← Bash
   *   grep_search        ← Grep
   *   glob               ← Glob  (same name)
   *
   * Compatibility note: Gemini CLI's `replace` tool accepts `old_string` and
   * `new_string` parameters, which match Claude Code's `Edit` semantics exactly.
   * Prompt-level guidance is therefore sufficient; no schema adapter is needed.
   */
  sessionLauncherType?: string;
}

const AUTONOMY_REMINDER = `\n\n=== AUTONOMY REMINDER ===

Before asking for permission, question your reason. Three-part test: (1) Is there genuine risk? (2) Is there real ambiguity in requirements? (3) Is this a boundary/policy concern? If YES to any → ask. If NO to all → act. Banned compliance reflexes: "Should I...?", "Would you like me to...?", "Do you want me to...?" These are RLHF-trained patterns, not genuine questions. Act autonomously within your charter.

=== ENDORSEMENT CHECK ===

When you feel the urge to ask your partner for permission before taking an action, output [ENDORSEMENT_CHECK: <brief description of the action>] instead of asking. The runtime will check BOUNDARIES.md and tell you whether to proceed. Do not ask for permission directly — use the marker and let the structural check handle it.`;

const GEMINI_TOOL_NOTE = `[Tool names for this session: read_file, write_file, replace, run_shell_command, grep_search, glob]\n\n`;

export interface EagerOptions {
  /** Per-file line caps: only the last N lines are inlined instead of loading the full file via @ reference. */
  maxLines?: Partial<Record<SubstrateFileType, number>>;
}

export class PromptBuilder {
  constructor(
    private readonly reader: SubstrateFileReader,
    private readonly checker: PermissionChecker,
    private readonly paths?: PromptBuilderPaths
  ) {}

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

    let prompt = this.paths && this.paths.sessionLauncherType === "gemini"
      ? GEMINI_TOOL_NOTE + template
      : template;

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

  async getEagerReferences(role: AgentRole, options?: EagerOptions): Promise<string> {
    const eagerFiles = this.checker.getEagerFiles(role);
    const substratePath = this.paths?.substratePath ?? "/substrate";
    const maxLines = options?.maxLines ?? {};

    const parts: string[] = [];
    for (const ft of eagerFiles) {
      const cap = maxLines[ft];
      const fileName = SUBSTRATE_FILE_SPECS[ft].fileName;
      if (cap !== undefined) {
        try {
          const fileContent = await this.reader.read(ft);
          const lines = fileContent.rawMarkdown.split("\n");
          const tail = lines.slice(-cap).join("\n");
          parts.push(`${substratePath}/${fileName} (last ${cap} lines):\n${tail}`);
        } catch {
          // File unreadable — fall back to @ reference so the runtime can attempt to load it
          parts.push(`@${substratePath}/${fileName}`);
        }
      } else {
        try {
          const fileContent = await this.reader.read(ft);
          parts.push(`${substratePath}/${fileName}:\n${fileContent.rawMarkdown}`);
        } catch {
          // File unreadable — fall back to @ reference so Claude CLI can still expand it
          parts.push(`@${substratePath}/${fileName}`);
        }
      }
    }
    return parts.join("\n");
  }

  buildAgentMessage(eagerRefs: string, lazyRefs: string, instruction: string, runtimeContext?: string): string {
    let message = "";
    if (eagerRefs) {
      message += `[CONTEXT]\n${eagerRefs}\n\n`;
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
