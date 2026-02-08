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
});
