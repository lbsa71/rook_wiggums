import { IFileSystem } from "../abstractions/IFileSystem";
import { IClock } from "../abstractions/IClock";
import { SubstrateConfig } from "../config";
import { SubstrateFileType, SUBSTRATE_FILE_SPECS, WriteMode } from "../types";
import { FileLock } from "./FileLock";

export class AppendOnlyWriter {
  constructor(
    private readonly fs: IFileSystem,
    private readonly config: SubstrateConfig,
    private readonly lock: FileLock,
    private readonly clock: IClock
  ) {}

  async append(fileType: SubstrateFileType, entry: string): Promise<void> {
    const spec = SUBSTRATE_FILE_SPECS[fileType];

    if (spec.writeMode !== WriteMode.APPEND) {
      throw new Error(
        `Cannot use AppendOnlyWriter for OVERWRITE-mode file type: ${fileType}`
      );
    }

    const release = await this.lock.acquire(fileType);
    try {
      const filePath = this.config.getFilePath(fileType);
      const timestamp = this.clock.now().toISOString();
      const formatted = `[${timestamp}] ${entry}\n`;
      await this.fs.appendFile(filePath, formatted);
    } finally {
      release();
    }
  }
}
