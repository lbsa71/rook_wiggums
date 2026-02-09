import { appendFileSync, existsSync, renameSync, statSync } from "fs";
import * as path from "path";

export interface ILogger {
  debug(message: string): void;
}

export class InMemoryLogger implements ILogger {
  private entries: string[] = [];

  debug(message: string): void {
    this.entries.push(message);
  }

  getEntries(): string[] {
    return [...this.entries];
  }
}

const MAX_LOG_SIZE_BYTES = 500 * 1024; // 500 KB

export class FileLogger implements ILogger {
  private readonly resolvedPath: string;

  constructor(filePath: string, maxSizeBytes?: number) {
    this.resolvedPath = filePath;
    this.rotateIfNeeded(maxSizeBytes ?? MAX_LOG_SIZE_BYTES);
    this.writeSessionHeader();
  }

  debug(message: string): void {
    const timestamp = new Date().toISOString();
    appendFileSync(this.resolvedPath, `[${timestamp}] ${message}\n`);
  }

  getFilePath(): string {
    return this.resolvedPath;
  }

  private rotateIfNeeded(maxSizeBytes: number): void {
    if (!existsSync(this.resolvedPath)) {
      return;
    }

    const stats = statSync(this.resolvedPath);
    if (stats.size < maxSizeBytes) {
      return;
    }

    const dir = path.dirname(this.resolvedPath);
    const timestamp = new Date().toISOString().replace(/:/g, "-");
    const rotatedName = `debug.${timestamp}.log`;
    const rotatedPath = path.join(dir, rotatedName);
    renameSync(this.resolvedPath, rotatedPath);
  }

  private writeSessionHeader(): void {
    const timestamp = new Date().toISOString();
    const separator = existsSync(this.resolvedPath) ? "\n" : "";
    appendFileSync(this.resolvedPath, `${separator}[${timestamp}] === Session started === log: ${this.resolvedPath}\n`);
  }
}
