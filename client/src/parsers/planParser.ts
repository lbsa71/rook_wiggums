export interface PlanTask {
  id: string;
  title: string;
  status: "PENDING" | "COMPLETE";
  children: PlanTask[];
}

interface RawLine {
  indent: number;
  checked: boolean;
  title: string;
}

export function parsePlanTasks(markdown: string): PlanTask[] {
  const lines = markdown.split("\n");
  const rawLines: RawLine[] = [];

  for (const line of lines) {
    const match = line.match(/^(\s*)- \[([ x])\] (.+)$/);
    if (match) {
      rawLines.push({
        indent: match[1].length,
        checked: match[2] === "x",
        title: match[3],
      });
    }
  }

  return buildTree(rawLines, null, 0, rawLines.length, -1);
}

function buildTree(
  lines: RawLine[],
  parentId: string | null,
  start: number,
  end: number,
  parentIndent: number
): PlanTask[] {
  const tasks: PlanTask[] = [];
  let counter = 1;
  let i = start;

  // Find minimum indent in range
  let minIndent = Infinity;
  for (let j = start; j < end; j++) {
    if (lines[j].indent < minIndent) minIndent = lines[j].indent;
  }

  while (i < end) {
    const line = lines[i];
    if (line.indent <= parentIndent && parentIndent >= 0) break;

    const isTopLevel = parentIndent < 0
      ? line.indent === minIndent
      : line.indent === parentIndent + 2;

    if (!isTopLevel) {
      i++;
      continue;
    }

    const id = parentId === null ? `task-${counter}` : `${parentId}.${counter}`;
    const childStart = i + 1;
    let childEnd = childStart;
    while (childEnd < end && lines[childEnd].indent > line.indent) {
      childEnd++;
    }

    const children = buildTree(lines, id, childStart, childEnd, line.indent);

    tasks.push({
      id,
      title: line.title,
      status: line.checked ? "COMPLETE" : "PENDING",
      children,
    });

    counter++;
    i = childEnd;
  }

  return tasks;
}
