import { SubstrateFileType, SUBSTRATE_FILE_SPECS } from "./types";

export class SubstrateConfig {
  readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  getFilePath(fileType: SubstrateFileType): string {
    const spec = SUBSTRATE_FILE_SPECS[fileType];
    return `${this.basePath}/${spec.fileName}`;
  }

  getBackupDir(): string {
    return `${this.basePath}/backups`;
  }
}
