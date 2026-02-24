import { WorkspaceManager } from "../../../src/agents/workspace/WorkspaceManager";
import { InMemoryFileSystem } from "../../../src/substrate/abstractions/InMemoryFileSystem";
import { AgentRole } from "../../../src/agents/types";

describe("WorkspaceManager", () => {
  it("returns correct workspace path for each role", () => {
    const fs = new InMemoryFileSystem();
    const manager = new WorkspaceManager(fs, "/layer");

    expect(manager.workspacePath(AgentRole.EGO)).toBe("/layer/workspaces/ego");
    expect(manager.workspacePath(AgentRole.SUBCONSCIOUS)).toBe("/layer/workspaces/subconscious");
    expect(manager.workspacePath(AgentRole.SUPEREGO)).toBe("/layer/workspaces/superego");
    expect(manager.workspacePath(AgentRole.ID)).toBe("/layer/workspaces/id");
  });

  it("creates workspace directories for all roles", async () => {
    const fs = new InMemoryFileSystem();
    const manager = new WorkspaceManager(fs, "/layer");

    await manager.ensureWorkspaces();

    expect(await fs.exists("/layer/workspaces/ego")).toBe(true);
    expect(await fs.exists("/layer/workspaces/subconscious")).toBe(true);
    expect(await fs.exists("/layer/workspaces/superego")).toBe(true);
    expect(await fs.exists("/layer/workspaces/id")).toBe(true);
  });

  it("is idempotent — calling ensureWorkspaces twice does not throw", async () => {
    const fs = new InMemoryFileSystem();
    const manager = new WorkspaceManager(fs, "/layer");

    await manager.ensureWorkspaces();
    await manager.ensureWorkspaces();

    expect(await fs.exists("/layer/workspaces/ego")).toBe(true);
  });
});
