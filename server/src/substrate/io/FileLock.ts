import { SubstrateFileType } from "../types";

export type Release = () => void;

export class FileLock {
  private chains = new Map<SubstrateFileType, Promise<void>>();

  async acquire(fileType: SubstrateFileType): Promise<Release> {
    const current = this.chains.get(fileType) ?? Promise.resolve();

    let release: Release;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.chains.set(fileType, next);

    await current;
    return release!;
  }
}
