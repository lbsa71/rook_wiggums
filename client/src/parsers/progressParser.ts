export interface ProgressEntry {
  timestamp: string;
  agent: string;
  message: string;
}

const PROGRESS_LINE_RE = /^\[([^\]]+)\]\s+(?:\[([A-Z_]+)\]\s+)?(.+)$/;

export function parseProgressEntries(rawMarkdown: string): ProgressEntry[] {
  return rawMarkdown
    .split("\n")
    .map((line) => PROGRESS_LINE_RE.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      timestamp: m[1],
      agent: m[2] ?? "",
      message: m[3],
    }));
}
