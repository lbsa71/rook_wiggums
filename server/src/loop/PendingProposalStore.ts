import * as path from "path";
import type { SubconsciousProposal } from "../agents/roles/Subconscious";
import type { IFileSystem } from "../substrate/abstractions/IFileSystem";

interface PendingProposalState {
  version: 1;
  proposals: SubconsciousProposal[];
}

function isProposal(value: unknown): value is SubconsciousProposal {
  if (!value || typeof value !== "object") return false;
  const proposal = value as Record<string, unknown>;
  return typeof proposal.target === "string"
    && typeof proposal.content === "string"
    && (proposal.mode === undefined || proposal.mode === "replace" || proposal.mode === "append");
}

function proposalKey(proposal: SubconsciousProposal): string {
  return JSON.stringify([
    proposal.target.toUpperCase(),
    proposal.mode ?? "append",
    proposal.content,
  ]);
}

/** Durable, fail-open storage for governed proposals awaiting Superego evaluation. */
export class PendingProposalStore {
  private readonly tempPath: string;

  constructor(
    private readonly fileSystem: IFileSystem,
    private readonly statePath: string,
    private readonly warn: (message: string) => void,
  ) {
    this.tempPath = `${statePath}.tmp`;
  }

  async load(): Promise<SubconsciousProposal[]> {
    try {
      if (!await this.fileSystem.exists(this.statePath)) return [];
      const parsed = JSON.parse(await this.fileSystem.readFile(this.statePath)) as unknown;
      if (!parsed || typeof parsed !== "object") throw new Error("state is not an object");
      const state = parsed as Partial<PendingProposalState>;
      if (state.version !== 1 || !Array.isArray(state.proposals) || !state.proposals.every(isProposal)) {
        throw new Error("state does not match version 1 schema");
      }
      return state.proposals;
    } catch (error) {
      this.warn(`corrupt pending proposal state at ${this.statePath}; failing open: ${error instanceof Error ? error.message : String(error)}`);
      try {
        if (await this.fileSystem.exists(this.statePath)) {
          await this.fileSystem.unlink(this.statePath);
        }
      } catch (cleanupError) {
        this.warn(`failed to remove corrupt pending proposal state at ${this.statePath}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
      return [];
    }
  }

  async mergeAndPersist(incoming: SubconsciousProposal[]): Promise<SubconsciousProposal[]> {
    const merged = [...await this.load(), ...incoming];
    const unique = [...new Map(merged.map((proposal) => [proposalKey(proposal), proposal])).values()];
    if (unique.length === 0) return [];
    await this.write(unique);
    return unique;
  }

  async clear(): Promise<void> {
    if (await this.fileSystem.exists(this.statePath)) {
      await this.fileSystem.unlink(this.statePath);
    }
  }

  private async write(proposals: SubconsciousProposal[]): Promise<void> {
    await this.fileSystem.mkdir(path.dirname(this.statePath), { recursive: true });
    const state: PendingProposalState = { version: 1, proposals };
    await this.fileSystem.writeFile(this.tempPath, `${JSON.stringify(state, null, 2)}\n`);
    await this.fileSystem.rename(this.tempPath, this.statePath);
  }
}
