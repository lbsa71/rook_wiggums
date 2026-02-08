import { PlanTask } from "../parsers/planParser";

interface TaskTreeProps {
  tasks: PlanTask[];
}

function TaskNode({ task }: { task: PlanTask }) {
  return (
    <li>
      <span className={`task-item ${task.status === "COMPLETE" ? "task-complete" : "task-pending"}`}>
        <input type="checkbox" checked={task.status === "COMPLETE"} readOnly />
        {task.title}
      </span>
      {task.children.length > 0 && (
        <ul className="task-children">
          {task.children.map((child) => (
            <TaskNode key={child.id} task={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TaskTree({ tasks }: TaskTreeProps) {
  if (tasks.length === 0) {
    return <p className="task-empty">No tasks</p>;
  }

  return (
    <ul className="task-tree" data-testid="task-tree">
      {tasks.map((task) => (
        <TaskNode key={task.id} task={task} />
      ))}
    </ul>
  );
}
