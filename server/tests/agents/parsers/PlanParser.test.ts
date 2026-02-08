import {
  PlanParser,
  TaskStatus,
} from "../../../src/agents/parsers/PlanParser";

const SIMPLE_PLAN = `# Plan

## Current Goal
Build the login feature

## Tasks
- [ ] Design login form
- [ ] Implement backend auth
- [x] Set up database
`;

const NESTED_PLAN = `# Plan

## Current Goal
Build the app

## Tasks
- [ ] Frontend
  - [ ] Login page
  - [x] Home page
- [ ] Backend
  - [ ] Auth API
  - [ ] User API
    - [ ] GET /users
    - [x] POST /users
`;

const ALL_COMPLETE = `# Plan

## Current Goal
Ship v1

## Tasks
- [x] Build frontend
- [x] Build backend
- [x] Deploy
`;

const EMPTY_PLAN = `# Plan

## Current Goal
Figure out what to do

## Tasks
`;

const NO_TASKS_SECTION = `# Plan

## Current Goal
Just thinking
`;

describe("PlanParser", () => {
  describe("parseCurrentGoal", () => {
    it("extracts the current goal text", () => {
      const goal = PlanParser.parseCurrentGoal(SIMPLE_PLAN);
      expect(goal).toBe("Build the login feature");
    });

    it("returns empty string when no current goal section", () => {
      const goal = PlanParser.parseCurrentGoal("# Plan\n\nJust text.");
      expect(goal).toBe("");
    });

    it("trims whitespace from goal", () => {
      const md = "# Plan\n\n## Current Goal\n  Spaces around  \n\n## Tasks";
      const goal = PlanParser.parseCurrentGoal(md);
      expect(goal).toBe("Spaces around");
    });
  });

  describe("parseTasks", () => {
    it("parses top-level unchecked tasks as PENDING", () => {
      const tasks = PlanParser.parseTasks(SIMPLE_PLAN);
      expect(tasks[0].title).toBe("Design login form");
      expect(tasks[0].status).toBe(TaskStatus.PENDING);
      expect(tasks[0].id).toBe("task-1");
    });

    it("parses checked tasks as COMPLETE", () => {
      const tasks = PlanParser.parseTasks(SIMPLE_PLAN);
      const dbTask = tasks.find((t) => t.title === "Set up database");
      expect(dbTask).toBeDefined();
      expect(dbTask!.status).toBe(TaskStatus.COMPLETE);
    });

    it("assigns sequential IDs", () => {
      const tasks = PlanParser.parseTasks(SIMPLE_PLAN);
      expect(tasks.map((t) => t.id)).toEqual(["task-1", "task-2", "task-3"]);
    });

    it("parses nested tasks with dot-notation IDs", () => {
      const tasks = PlanParser.parseTasks(NESTED_PLAN);
      const frontend = tasks.find((t) => t.id === "task-1");
      expect(frontend).toBeDefined();
      expect(frontend!.children).toHaveLength(2);
      expect(frontend!.children[0].id).toBe("task-1.1");
      expect(frontend!.children[0].title).toBe("Login page");
      expect(frontend!.children[1].id).toBe("task-1.2");
      expect(frontend!.children[1].title).toBe("Home page");
      expect(frontend!.children[1].status).toBe(TaskStatus.COMPLETE);
    });

    it("parses deeply nested tasks", () => {
      const tasks = PlanParser.parseTasks(NESTED_PLAN);
      const backend = tasks.find((t) => t.id === "task-2");
      expect(backend).toBeDefined();
      const userApi = backend!.children.find((t) => t.id === "task-2.2");
      expect(userApi).toBeDefined();
      expect(userApi!.children).toHaveLength(2);
      expect(userApi!.children[0].id).toBe("task-2.2.1");
      expect(userApi!.children[0].title).toBe("GET /users");
      expect(userApi!.children[1].id).toBe("task-2.2.2");
      expect(userApi!.children[1].status).toBe(TaskStatus.COMPLETE);
    });

    it("returns empty array when no tasks", () => {
      expect(PlanParser.parseTasks(EMPTY_PLAN)).toEqual([]);
    });

    it("returns empty array when no tasks section", () => {
      expect(PlanParser.parseTasks(NO_TASKS_SECTION)).toEqual([]);
    });
  });

  describe("findNextActionable", () => {
    it("returns the first PENDING leaf task (depth-first)", () => {
      const tasks = PlanParser.parseTasks(NESTED_PLAN);
      const next = PlanParser.findNextActionable(tasks);
      expect(next).toBeDefined();
      expect(next!.id).toBe("task-1.1");
      expect(next!.title).toBe("Login page");
    });

    it("skips completed tasks", () => {
      const tasks = PlanParser.parseTasks(SIMPLE_PLAN);
      const next = PlanParser.findNextActionable(tasks);
      expect(next!.title).toBe("Design login form");
    });

    it("returns null when all tasks are complete", () => {
      const tasks = PlanParser.parseTasks(ALL_COMPLETE);
      expect(PlanParser.findNextActionable(tasks)).toBeNull();
    });

    it("returns null when there are no tasks", () => {
      expect(PlanParser.findNextActionable([])).toBeNull();
    });
  });

  describe("markComplete", () => {
    it("toggles a task from [ ] to [x]", () => {
      const updated = PlanParser.markComplete(SIMPLE_PLAN, "task-1");
      expect(updated).toContain("- [x] Design login form");
    });

    it("does not change already complete tasks", () => {
      const updated = PlanParser.markComplete(SIMPLE_PLAN, "task-3");
      expect(updated).toContain("- [x] Set up database");
      expect(updated).toBe(SIMPLE_PLAN);
    });

    it("marks nested tasks complete", () => {
      const updated = PlanParser.markComplete(NESTED_PLAN, "task-1.1");
      expect(updated).toContain("- [x] Login page");
    });

    it("throws for unknown task ID", () => {
      expect(() => PlanParser.markComplete(SIMPLE_PLAN, "task-99")).toThrow(
        "Task task-99 not found"
      );
    });
  });

  describe("isComplete", () => {
    it("returns true when all tasks are complete", () => {
      const tasks = PlanParser.parseTasks(ALL_COMPLETE);
      expect(PlanParser.isComplete(tasks)).toBe(true);
    });

    it("returns false when some tasks are pending", () => {
      const tasks = PlanParser.parseTasks(SIMPLE_PLAN);
      expect(PlanParser.isComplete(tasks)).toBe(false);
    });

    it("returns true for empty task list", () => {
      expect(PlanParser.isComplete([])).toBe(true);
    });
  });

  describe("isEmpty", () => {
    it("returns true for empty task list", () => {
      expect(PlanParser.isEmpty([])).toBe(true);
    });

    it("returns false when tasks exist", () => {
      const tasks = PlanParser.parseTasks(SIMPLE_PLAN);
      expect(PlanParser.isEmpty(tasks)).toBe(false);
    });
  });
});
