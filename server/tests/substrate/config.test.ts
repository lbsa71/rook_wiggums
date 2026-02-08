import { SubstrateConfig } from "../../src/substrate/config";
import { SubstrateFileType } from "../../src/substrate/types";

describe("SubstrateConfig", () => {
  const config = new SubstrateConfig("/home/agent/substrate");

  it("resolves file path for a given file type", () => {
    expect(config.getFilePath(SubstrateFileType.PLAN)).toBe(
      "/home/agent/substrate/PLAN.md"
    );
  });

  it("resolves file path for CONVERSATION", () => {
    expect(config.getFilePath(SubstrateFileType.CONVERSATION)).toBe(
      "/home/agent/substrate/CONVERSATION.md"
    );
  });

  it("returns backup directory path", () => {
    expect(config.getBackupDir()).toBe("/home/agent/substrate/backups");
  });

  it("exposes the base path", () => {
    expect(config.basePath).toBe("/home/agent/substrate");
  });
});
