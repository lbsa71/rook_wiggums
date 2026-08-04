import { IFileSystem } from "../abstractions/IFileSystem";
import { SubstrateConfig } from "../config";
import { SubstrateFileType } from "../types";

const LEGACY_INSTRUCTION_FILE = "CLAUDE.md";

export interface LegacyInstructionMigrationReport {
  copiedFromLegacy: boolean;
}

/**
 * Preserves provider-named instruction files while making AGENTS.md canonical.
 * The legacy file remains in place as a recoverable compatibility artifact but
 * is no longer part of the runtime substrate registry.
 */
export class LegacyInstructionMigrator {
  constructor(
    private readonly fs: IFileSystem,
    private readonly config: SubstrateConfig
  ) {}

  async migrate(): Promise<LegacyInstructionMigrationReport> {
    await this.fs.mkdir(this.config.basePath, { recursive: true });

    const agentsPath = this.config.getFilePath(SubstrateFileType.AGENTS);
    if (await this.fs.exists(agentsPath)) {
      return { copiedFromLegacy: false };
    }

    const legacyPath = `${this.config.basePath}/${LEGACY_INSTRUCTION_FILE}`;
    if (!(await this.fs.exists(legacyPath))) {
      return { copiedFromLegacy: false };
    }

    await this.fs.copyFile(legacyPath, agentsPath);
    return { copiedFromLegacy: true };
  }
}
