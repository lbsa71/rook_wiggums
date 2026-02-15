import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TaskTree } from "../../src/components/TaskTree";
import { parsePlanTasks } from "../../src/parsers/planParser";

describe("TaskTree", () => {
  it("renders pending and completed tasks from parsed plan", () => {
    const markdown = "# Plan\n\n## Tasks\n- [ ] Build feature\n- [x] Write tests";
    const tasks = parsePlanTasks(markdown);

    render(<TaskTree tasks={tasks} />);

    expect(screen.getByText("Build feature")).toBeInTheDocument();
    expect(screen.getByText("Write tests")).toBeInTheDocument();
  });

  it("renders nested tasks as a tree", () => {
    const markdown = "# Plan\n\n## Tasks\n- [ ] Parent task\n  - [ ] Child A\n  - [x] Child B";
    const tasks = parsePlanTasks(markdown);

    render(<TaskTree tasks={tasks} />);

    expect(screen.getByText("Parent task")).toBeInTheDocument();
    expect(screen.getByText("Child A")).toBeInTheDocument();
    expect(screen.getByText("Child B")).toBeInTheDocument();
  });

  it("shows empty message when no tasks", () => {
    render(<TaskTree tasks={[]} />);

    expect(screen.getByText("No tasks")).toBeInTheDocument();
  });
});

describe("parsePlanTasks", () => {
  it("parses task lines into structured data", () => {
    const markdown = "# Plan\n\n## Tasks\n- [ ] Task A\n- [x] Task B";
    const tasks = parsePlanTasks(markdown);

    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toBe("Task A");
    expect(tasks[0].status).toBe("PENDING");
    expect(tasks[1].title).toBe("Task B");
    expect(tasks[1].status).toBe("COMPLETE");
  });

  it("parses tasks from any ## section, not just ## Tasks", () => {
    const markdown = "# Plan\n\n## Phase 1\n- [x] Done thing\n\n## Phase 2\n- [ ] Pending thing";
    const tasks = parsePlanTasks(markdown);

    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toBe("Done thing");
    expect(tasks[0].status).toBe("COMPLETE");
    expect(tasks[1].title).toBe("Pending thing");
    expect(tasks[1].status).toBe("PENDING");
  });

  it("parses tasks from a mix of custom sections", () => {
    const markdown = "# Plan\n\n## Current Goal\n\nSome text\n\n## Phase 1: REMEDIATION\n- [x] Fix bug\n- [x] Add test\n\n## Phase 2: FEATURES\n- [ ] Add widget\n";
    const tasks = parsePlanTasks(markdown);

    expect(tasks).toHaveLength(3);
    expect(tasks[0].title).toBe("Fix bug");
    expect(tasks[2].title).toBe("Add widget");
  });
});
