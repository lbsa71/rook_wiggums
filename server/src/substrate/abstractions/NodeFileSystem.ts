import * as fs from "node:fs/promises";
import { IFileSystem, FileStat } from "./IFileSystem";
import { toPosix } from "./pathUtils";

export class NodeFileSystem implements IFileSystem {
  async readFile(p: string): Promise<string> {
    return fs.readFile(toPosix(p), "utf-8");
  }

  async writeFile(p: string, content: string): Promise<void> {
    await fs.writeFile(toPosix(p), content, "utf-8");
  }

  async appendFile(p: string, content: string): Promise<void> {
    await fs.appendFile(toPosix(p), content, "utf-8");
  }

  async exists(p: string): Promise<boolean> {
    try {
      await fs.access(toPosix(p));
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(p: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(toPosix(p), options);
  }

  async stat(p: string): Promise<FileStat> {
    const stat = await fs.stat(toPosix(p));
    return {
      mtimeMs: stat.mtimeMs,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
    };
  }

  async readdir(p: string): Promise<string[]> {
    return fs.readdir(toPosix(p));
  }

  async copyFile(src: string, dest: string): Promise<void> {
    await fs.copyFile(toPosix(src), toPosix(dest));
  }

  async unlink(p: string): Promise<void> {
    await fs.unlink(toPosix(p));
  }
}
