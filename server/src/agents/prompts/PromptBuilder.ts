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

export class PromptBuilder {
  constructor(
    private readonly reader: SubstrateFileReader,
    private readonly checker: PermissionChecker
  ) {}

  async gatherContext(role: AgentRole): Promise<FileContext[]> {
    const readableFiles = this.checker.getReadableFiles(role);
    const contexts: FileContext[] = [];

    for (const fileType of readableFiles) {
      const fileContent = await this.reader.read(fileType);
      contexts.push({
        fileType,
        fileName: SUBSTRATE_FILE_SPECS[fileType].fileName,
        content: fileContent.rawMarkdown,
      });
    }

    return contexts;
  }

  async buildSystemPrompt(role: AgentRole): Promise<string> {
    const template = ROLE_PROMPTS[role];
    const contexts = await this.gatherContext(role);

    const contextSections = contexts
      .map((c) => `--- ${c.fileName} ---\n${c.content}`)
      .join("\n\n");

    return `${template}\n\n=== SUBSTRATE CONTEXT ===\n\n${contextSections}`;
  }
}
