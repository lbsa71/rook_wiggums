/**
 * Normalize paths to POSIX style (forward slashes) for cross-platform consistency.
 * All abstract environment (IFileSystem, etc.) should use normalized paths so tests
 * and production behave identically on Windows and Unix.
 */
export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}
