import * as path from "path";
import type { SubconsciousProposal } from "../agents/roles/Subconscious";
import type { IFileSystem } from "../substrate/abstractions/IFileSystem";

interface PendingProposalState {
  version: 2;
  proposals: SubconsciousProposal[];
  completedProposalKeys: string[];
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
    const state = await this.loadState();
    const completed = new Set(state.completedProposalKeys);
    return state.proposals.filter((proposal) => !completed.has(proposalKey(proposal)));
  }

  async mergeAndPersist(incoming: SubconsciousProposal[]): Promise<SubconsciousProposal[]> {
    const state = await this.loadState();
    const merged = [...state.proposals, ...incoming];
    const proposals = [...new Map(merged.map((proposal) => [proposalKey(proposal), proposal])).values()];
    const knownKeys = new Set(proposals.map(proposalKey));
    const completedProposalKeys = state.completedProposalKeys.filter((key) => knownKeys.has(key));
    const completed = new Set(completedProposalKeys);
    const pending = proposals.filter((proposal) => !completed.has(proposalKey(proposal)));
    if (pending.length === 0) {
      await this.clear();
      return [];
    }
    await this.write({ version: 2, proposals, completedProposalKeys });
    return pending;
  }

  /** Persist one completed effect before advancing to the next proposal. */
  async markCompleted(proposal: SubconsciousProposal): Promise<void> {
    const state = await this.loadState();
    const key = proposalKey(proposal);
    if (!state.proposals.some((candidate) => proposalKey(candidate) === key)) {
      throw new Error("cannot receipt a proposal that is not in the pending batch");
    }
    const completedProposalKeys = [...new Set([...state.completedProposalKeys, key])];
    await this.write({ ...state, completedProposalKeys });
  }

  async clear(): Promise<void> {
    if (await this.fileSystem.exists(this.statePath)) {
      await this.fileSystem.unlink(this.statePath);
    }
  }

  private async loadState(): Promise<PendingProposalState> {
    try {
      if (!await this.fileSystem.exists(this.statePath)) {
        return { version: 2, proposals: [], completedProposalKeys: [] };
      }
      const parsed = JSON.parse(await this.fileSystem.readFile(this.statePath)) as unknown;
      if (!parsed || typeof parsed !== "object") throw new Error("state is not an object");
      const state = parsed as {
        version?: unknown;
        proposals?: unknown;
        completedProposalKeys?: unknown;
      };
      if (!Array.isArray(state.proposals) || !state.proposals.every(isProposal)) {
        throw new Error("state has invalid proposals");
      }
      if (state.version === 1) {
        return { version: 2, proposals: state.proposals, completedProposalKeys: [] };
      }
      if (state.version !== 2
        || !Array.isArray(state.completedProposalKeys)
        || !state.completedProposalKeys.every((key) => typeof key === "string")) {
        throw new Error("state does not match version 1 or version 2 schema");
      }
      return {
        version: 2,
        proposals: state.proposals,
        completedProposalKeys: state.completedProposalKeys,
      };
    } catch (error) {
      this.warn(`corrupt pending proposal state at ${this.statePath}; failing open: ${error instanceof Error ? error.message : String(error)}`);
      try {
        if (await this.fileSystem.exists(this.statePath)) {
          await this.fileSystem.unlink(this.statePath);
        }
      } catch (cleanupError) {
        this.warn(`failed to remove corrupt pending proposal state at ${this.statePath}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
      return { version: 2, proposals: [], completedProposalKeys: [] };
    }
  }

  private async write(state: PendingProposalState): Promise<void> {
    await this.fileSystem.mkdir(path.dirname(this.statePath), { recursive: true });
    await this.fileSystem.writeFile(this.tempPath, `${JSON.stringify(state, null, 2)}\n`);
    await this.fileSystem.rename(this.tempPath, this.statePath);
  }
}
