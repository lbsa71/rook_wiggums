import { createHash } from "node:crypto";
import { IFileSystem } from "../abstractions/IFileSystem";
import { SubstrateConfig } from "../config";
import { SubstrateFileType } from "../types";

export interface SubstrateFileMeta {
  fileType: SubstrateFileType;
  filePath: string;
  lastModified: number;
  contentHash: string;
}

export interface SubstrateFileContent {
  meta: SubstrateFileMeta;
  rawMarkdown: string;
}

export class SubstrateFileReader {
  constructor(
    private readonly fs: IFileSystem,
    private readonly config: SubstrateConfig
  ) {}

  async read(fileType: SubstrateFileType): Promise<SubstrateFileContent> {
    const filePath = this.config.getFilePath(fileType);
    const rawMarkdown = await this.fs.readFile(filePath);
    const stat = await this.fs.stat(filePath);
    const contentHash = createHash("sha256").update(rawMarkdown).digest("hex");

    return {
      meta: {
        fileType,
        filePath,
        lastModified: stat.mtimeMs,
        contentHash,
      },
      rawMarkdown,
    };
  }
}
