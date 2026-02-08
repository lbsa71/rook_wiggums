import { IFileSystem } from "../abstractions/IFileSystem";
import { SubstrateConfig } from "../config";
import { SubstrateFileType } from "../types";
import { getTemplate } from "../templates/index";

export interface InitializationReport {
  created: SubstrateFileType[];
  alreadyExisted: SubstrateFileType[];
}

export class SubstrateInitializer {
  constructor(
    private readonly fs: IFileSystem,
    private readonly config: SubstrateConfig
  ) {}

  async initialize(): Promise<InitializationReport> {
    await this.fs.mkdir(this.config.basePath, { recursive: true });

    const created: SubstrateFileType[] = [];
    const alreadyExisted: SubstrateFileType[] = [];

    for (const fileType of Object.values(SubstrateFileType)) {
      const filePath = this.config.getFilePath(fileType);

      if (await this.fs.exists(filePath)) {
        alreadyExisted.push(fileType);
      } else {
        await this.fs.writeFile(filePath, getTemplate(fileType));
        created.push(fileType);
      }
    }

    return { created, alreadyExisted };
  }
}
