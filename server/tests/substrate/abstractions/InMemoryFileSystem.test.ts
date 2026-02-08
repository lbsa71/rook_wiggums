import { InMemoryFileSystem } from "../../../src/substrate/abstractions/InMemoryFileSystem";

describe("InMemoryFileSystem", () => {
  let fs: InMemoryFileSystem;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
  });

  describe("writeFile / readFile", () => {
    it("writes and reads a file", async () => {
      await fs.writeFile("/test.txt", "hello");
      expect(await fs.readFile("/test.txt")).toBe("hello");
    });

    it("overwrites existing file", async () => {
      await fs.writeFile("/test.txt", "first");
      await fs.writeFile("/test.txt", "second");
      expect(await fs.readFile("/test.txt")).toBe("second");
    });

    it("throws when reading non-existent file", async () => {
      await expect(fs.readFile("/missing.txt")).rejects.toThrow("ENOENT");
    });
  });

  describe("appendFile", () => {
    it("appends to existing file", async () => {
      await fs.writeFile("/log.txt", "line1\n");
      await fs.appendFile("/log.txt", "line2\n");
      expect(await fs.readFile("/log.txt")).toBe("line1\nline2\n");
    });

    it("creates file if it does not exist", async () => {
      await fs.appendFile("/new.txt", "content");
      expect(await fs.readFile("/new.txt")).toBe("content");
    });
  });

  describe("exists", () => {
    it("returns false for non-existent path", async () => {
      expect(await fs.exists("/nope")).toBe(false);
    });

    it("returns true for existing file", async () => {
      await fs.writeFile("/file.txt", "data");
      expect(await fs.exists("/file.txt")).toBe(true);
    });

    it("returns true for existing directory", async () => {
      await fs.mkdir("/dir");
      expect(await fs.exists("/dir")).toBe(true);
    });
  });

  describe("mkdir", () => {
    it("creates a directory", async () => {
      await fs.mkdir("/mydir");
      expect(await fs.exists("/mydir")).toBe(true);
    });

    it("creates nested directories with recursive option", async () => {
      await fs.mkdir("/a/b/c", { recursive: true });
      expect(await fs.exists("/a")).toBe(true);
      expect(await fs.exists("/a/b")).toBe(true);
      expect(await fs.exists("/a/b/c")).toBe(true);
    });

    it("throws when parent does not exist without recursive", async () => {
      await expect(fs.mkdir("/a/b")).rejects.toThrow("ENOENT");
    });
  });

  describe("stat", () => {
    it("returns stat for a file", async () => {
      await fs.writeFile("/file.txt", "data");
      const stat = await fs.stat("/file.txt");
      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.mtimeMs).toBeGreaterThan(0);
    });

    it("returns stat for a directory", async () => {
      await fs.mkdir("/dir");
      const stat = await fs.stat("/dir");
      expect(stat.isFile).toBe(false);
      expect(stat.isDirectory).toBe(true);
    });

    it("throws for non-existent path", async () => {
      await expect(fs.stat("/missing")).rejects.toThrow("ENOENT");
    });
  });

  describe("readdir", () => {
    it("lists files in a directory", async () => {
      await fs.mkdir("/dir");
      await fs.writeFile("/dir/a.txt", "a");
      await fs.writeFile("/dir/b.txt", "b");
      const entries = await fs.readdir("/dir");
      expect(entries.sort()).toEqual(["a.txt", "b.txt"]);
    });

    it("throws for non-existent directory", async () => {
      await expect(fs.readdir("/missing")).rejects.toThrow("ENOENT");
    });
  });

  describe("copyFile", () => {
    it("copies file content to a new path", async () => {
      await fs.writeFile("/src.txt", "content");
      await fs.copyFile("/src.txt", "/dest.txt");
      expect(await fs.readFile("/dest.txt")).toBe("content");
    });

    it("throws when source does not exist", async () => {
      await expect(fs.copyFile("/missing.txt", "/dest.txt")).rejects.toThrow("ENOENT");
    });
  });
});
