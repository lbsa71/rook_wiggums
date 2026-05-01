import { IClock } from "../abstractions/IClock";
import { IFileSystem } from "../abstractions/IFileSystem";
import { SubstrateConfig } from "../config";
import { getTemplate } from "../templates";
import { SubstrateFileType } from "../types";

export interface MigrationReport {
  applied: string[];
  skipped: string[];
}

interface MigrationState {
  applied: string[];
}

interface Migration {
  id: string;
  apply(): Promise<void>;
}

const MIGRATION_STATE_FILE = ".substrate-migrations.json";
const CONVERSATION_OPERATING_CONTEXT_MIGRATION = "conversation-operating-context-v1";
const HABITS_MARKER_HEADER = "## Agora Marker Cleanup";

export class SubstrateMigrator {
  constructor(
    private readonly fs: IFileSystem,
    private readonly config: SubstrateConfig,
    private readonly clock: IClock
  ) {}

  async migrate(): Promise<MigrationReport> {
    const state = await this.readState();
    const applied = new Set(state.applied);
    const report: MigrationReport = { applied: [], skipped: [] };

    for (const migration of this.getMigrations()) {
      if (applied.has(migration.id)) {
        report.skipped.push(migration.id);
        continue;
      }
      await migration.apply();
      applied.add(migration.id);
      report.applied.push(migration.id);
      await this.writeState({ applied: [...applied].sort() });
    }

    return report;
  }

  private getMigrations(): Migration[] {
    return [
      {
        id: CONVERSATION_OPERATING_CONTEXT_MIGRATION,
        apply: () => this.applyConversationOperatingContextMigration(),
      },
    ];
  }

  private async applyConversationOperatingContextMigration(): Promise<void> {
    const operatingContextPath = this.config.getFilePath(SubstrateFileType.OPERATING_CONTEXT);
    if (!(await this.fs.exists(operatingContextPath))) {
      await this.fs.writeFile(operatingContextPath, getTemplate(SubstrateFileType.OPERATING_CONTEXT));
    }

    await this.appendHabitsGuidance();
    await this.appendProgressNote(CONVERSATION_OPERATING_CONTEXT_MIGRATION);
  }

  private async appendHabitsGuidance(): Promise<void> {
    const habitsPath = this.config.getFilePath(SubstrateFileType.HABITS);
    let habits = "";
    try {
      habits = await this.fs.readFile(habitsPath);
    } catch {
      habits = getTemplate(SubstrateFileType.HABITS);
      await this.fs.writeFile(habitsPath, habits);
    }

    if (habits.includes(HABITS_MARKER_HEADER)) {
      return;
    }

    const section = `${HABITS_MARKER_HEADER}

When processing a CONVERSATION.md line marked \`**[UNPROCESSED]**\` or \`**[UNPROCESSED ...]**\`, respond once and then remove the entire matching badge from that line. Do not leave stale unprocessed badges.

`;
    await this.fs.writeFile(habitsPath, `${habits.trimEnd()}\n\n${section}`);
  }

  private async appendProgressNote(migrationId: string): Promise<void> {
    const progressPath = this.config.getFilePath(SubstrateFileType.PROGRESS);
    const note = `[${this.clock.now().toISOString()}] [SYSTEM] Migration ${migrationId} applied: existing substrate preserved; OPERATING_CONTEXT.md and Agora marker cleanup guidance ensured.\n`;
    await this.fs.appendFile(progressPath, note);
  }

  private async readState(): Promise<MigrationState> {
    try {
      const raw = await this.fs.readFile(this.statePath());
      const parsed = JSON.parse(raw) as Partial<MigrationState>;
      return { applied: Array.isArray(parsed.applied) ? parsed.applied.filter((id): id is string => typeof id === "string") : [] };
    } catch {
      return { applied: [] };
    }
  }

  private async writeState(state: MigrationState): Promise<void> {
    await this.fs.writeFile(this.statePath(), `${JSON.stringify(state, null, 2)}\n`);
  }

  private statePath(): string {
    return `${this.config.basePath}/${MIGRATION_STATE_FILE}`;
  }
}
