import {
  AgentRole,
  FileAccessLevel,
  FilePermission,
  AgentAction,
  FileWriteAction,
  FileAppendAction,
  TaskDispatch,
} from "../../src/agents/types";
import { SubstrateFileType } from "../../src/substrate/types";

describe("AgentRole", () => {
  it("defines all 4 cognitive roles", () => {
    const roles = Object.values(AgentRole);
    expect(roles).toHaveLength(4);
  });

  it("includes expected roles", () => {
    expect(AgentRole.EGO).toBe("EGO");
    expect(AgentRole.SUBCONSCIOUS).toBe("SUBCONSCIOUS");
    expect(AgentRole.SUPEREGO).toBe("SUPEREGO");
    expect(AgentRole.ID).toBe("ID");
  });
});

describe("FileAccessLevel", () => {
  it("defines READ, WRITE, APPEND", () => {
    expect(FileAccessLevel.READ).toBe("READ");
    expect(FileAccessLevel.WRITE).toBe("WRITE");
    expect(FileAccessLevel.APPEND).toBe("APPEND");
  });

  it("has exactly 3 levels", () => {
    expect(Object.values(FileAccessLevel)).toHaveLength(3);
  });
});

describe("FilePermission", () => {
  it("associates a file type with an access level", () => {
    const perm: FilePermission = {
      fileType: SubstrateFileType.PLAN,
      accessLevel: FileAccessLevel.WRITE,
    };
    expect(perm.fileType).toBe(SubstrateFileType.PLAN);
    expect(perm.accessLevel).toBe(FileAccessLevel.WRITE);
  });
});

describe("AgentAction", () => {
  it("has a type discriminator and role", () => {
    const action: AgentAction = {
      type: "file_write",
      role: AgentRole.EGO,
    };
    expect(action.type).toBe("file_write");
    expect(action.role).toBe(AgentRole.EGO);
  });
});

describe("FileWriteAction", () => {
  it("extends AgentAction with file write details", () => {
    const action: FileWriteAction = {
      type: "file_write",
      role: AgentRole.SUBCONSCIOUS,
      fileType: SubstrateFileType.SKILLS,
      content: "# Skills\n\n## New Skill",
    };
    expect(action.type).toBe("file_write");
    expect(action.fileType).toBe(SubstrateFileType.SKILLS);
    expect(action.content).toBe("# Skills\n\n## New Skill");
  });
});

describe("FileAppendAction", () => {
  it("extends AgentAction with file append details", () => {
    const action: FileAppendAction = {
      type: "file_append",
      role: AgentRole.SUPEREGO,
      fileType: SubstrateFileType.PROGRESS,
      entry: "Audit complete: no issues found",
    };
    expect(action.type).toBe("file_append");
    expect(action.fileType).toBe(SubstrateFileType.PROGRESS);
    expect(action.entry).toBe("Audit complete: no issues found");
  });
});

describe("TaskDispatch", () => {
  it("describes a task to delegate to another role", () => {
    const dispatch: TaskDispatch = {
      type: "task_dispatch",
      role: AgentRole.EGO,
      targetRole: AgentRole.SUBCONSCIOUS,
      taskId: "task-1",
      description: "Implement the login feature",
    };
    expect(dispatch.type).toBe("task_dispatch");
    expect(dispatch.targetRole).toBe(AgentRole.SUBCONSCIOUS);
    expect(dispatch.taskId).toBe("task-1");
    expect(dispatch.description).toBe("Implement the login feature");
  });
});
