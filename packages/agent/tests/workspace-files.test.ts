import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { loadMentionedFiles, searchWorkspaceFiles } from "../src/workspace-files.ts";

describe("searchWorkspaceFiles", () => {
  test("ranks basename hits and skips node_modules", async () => {
    const root = await mkdtemp(join(tmpdir(), "cbot-files-"));
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await Bun.write(join(root, "README.md"), "hi");
    await Bun.write(join(root, "src", "read.ts"), "export {}");
    await Bun.write(join(root, "node_modules", "pkg", "read.ts"), "nope");
    const hits = await searchWorkspaceFiles(root, "read");
    expect(hits).toContain("src/read.ts");
    expect(hits).toContain("README.md");
    expect(hits.some((path) => path.includes("node_modules"))).toBe(false);
  });
});

describe("loadMentionedFiles", () => {
  test("loads workspace files and skips bot handles", async () => {
    const root = await mkdtemp(join(tmpdir(), "cbot-attach-"));
    await Bun.write(join(root, "note.txt"), "hello file");
    const files = await loadMentionedFiles(root, ["note.txt", "leader", "../secret"], new Set(["leader"]));
    expect(files).toEqual([{ path: "note.txt", content: "hello file" }]);
  });
});
