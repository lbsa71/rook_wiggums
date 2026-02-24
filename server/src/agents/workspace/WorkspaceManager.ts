import * as path from "path";
import { IFileSystem } from "../../substrate/abstractions/IFileSystem";
import { AgentRole } from "../types";

const ALL_ROLES = [AgentRole.EGO, AgentRole.SUBCONSCIOUS, AgentRole.SUPEREGO, AgentRole.ID];

export class WorkspaceManager {
  constructor(
    private readonly fs: IFileSystem,
    private readonly layerPath: string,
  ) {}

  workspacePath(role: AgentRole): string {
    return path.join(this.layerPath, "workspaces", role.toLowerCase());
  }

  async ensureWorkspaces(): Promise<void> {
    for (const role of ALL_ROLES) {
      await this.fs.mkdir(this.workspacePath(role), { recursive: true });
    }
  }
}
