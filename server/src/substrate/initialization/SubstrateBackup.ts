import { IFileSystem } from "../abstractions/IFileSystem";
import { IClock } from "../abstractions/IClock";
import { SubstrateConfig } from "../config";
import { SubstrateFileType, SUBSTRATE_FILE_SPECS } from "../types";

export class SubstrateBackup {
  constructor(
    private readonly fs: IFileSystem,
    private readonly clock: IClock,
    private readonly config: SubstrateConfig
  ) {}

  async backup(fileType: SubstrateFileType): Promise<string> {
    const spec = SUBSTRATE_FILE_SPECS[fileType];
    const sourcePath = this.config.getFilePath(fileType);
    const backupDir = this.config.getBackupDir();

    await this.fs.mkdir(backupDir, { recursive: true });

    const timestamp = this.clock.now().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${backupDir}/${spec.fileName}.${timestamp}.bak`;

    await this.fs.copyFile(sourcePath, backupPath);

    return backupPath;
  }
}
