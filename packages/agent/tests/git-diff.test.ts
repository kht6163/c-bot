import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitDiffError, gitDiff } from "../src/git-diff.ts";
import { gitStatus } from "../src/git-status.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function git(root: string, ...args: string[]) {
  const proc = Bun.spawn(["git", ...args], { cwd: root, stdout: "ignore", stderr: "pipe" });
  const error = await new Response(proc.stderr).text();
  if (await proc.exited !== 0) throw new Error(error);
}
async function repo() {
  const root = await mkdtemp(join(tmpdir(), "cbot-diff-"));
  roots.push(root);
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "test@example.test");
  await git(root, "config", "user.name", "Test");
  await writeFile(join(root, "tracked.txt"), "original\n");
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "initial");
  return root;
}

test("separates index and working changes, including deletion", async () => {
  const root = await repo();
  await writeFile(join(root, "tracked.txt"), "staged\n");
  await git(root, "add", ".");
  await writeFile(join(root, "tracked.txt"), "working\n");
  const staged = await gitDiff(root, "tracked.txt", "staged");
  const unstaged = await gitDiff(root, "tracked.txt", "unstaged");
  expect(staged.patch).toContain("-original\n+staged");
  expect(unstaged.patch).toContain("-staged\n+working");
  await rm(join(root, "tracked.txt"));
  expect((await gitDiff(root, "tracked.txt", "unstaged")).patch).toContain("-staged");
});

test("raw filenames and literal pathspecs select only one file", async () => {
  const root = await repo();
  const path = '한글\n"[abc]*.txt';
  await writeFile(join(root, path), "selected\n");
  await writeFile(join(root, "a.txt"), "unrelated\n");
  expect((await gitStatus(root)).files.map((file) => file.path)).toContain(path);
  expect((await gitDiff(root, path, "untracked")).patch).toContain("+selected");
  await git(root, "add", ".");
  const result = await gitDiff(root, path, "staged");
  expect(result.patch).toContain("+selected");
  expect(result.patch).not.toContain("unrelated");
});

test("renames show source and destination", async () => {
  const root = await repo();
  await git(root, "mv", "tracked.txt", "renamed.txt");
  const result = await gitDiff(root, "renamed.txt", "staged");
  expect(result.patch).toContain("rename from tracked.txt");
  expect(result.patch).toContain("rename to renamed.txt");
});

test("subdirectory workspace excludes sibling changes and rejects traversal", async () => {
  const root = await repo();
  await mkdir(join(root, "sub"));
  await writeFile(join(root, "sub", "inside.txt"), "inside\n");
  await writeFile(join(root, "outside.txt"), "outside\n");
  const workspace = join(root, "sub");
  expect((await gitStatus(workspace)).files.map((file) => file.path)).toEqual(["inside.txt"]);
  expect((await gitDiff(workspace, "inside.txt", "untracked")).patch).toContain("+inside");
  await expect(gitDiff(workspace, "../outside.txt", "untracked")).rejects.toThrow(GitDiffError);
});

test("binary files and bounded previews are explicit", async () => {
  const root = await repo();
  await writeFile(join(root, "binary"), new Uint8Array([0, 1, 2]));
  expect((await gitDiff(root, "binary", "untracked")).binary).toBe(true);
  await writeFile(join(root, "large"), "line\n".repeat(100_000));
  const large = await gitDiff(root, "large", "untracked");
  expect(large.truncated).toBe(true);
  expect(large.patch.length).toBeLessThanOrEqual(256 * 1024);
});

test("untracked symlinks expose only link text, never target contents", async () => {
  const root = await repo();
  await writeFile(join(root, "secret"), "DO_NOT_READ_SECRET\n");
  await mkdir(join(root, "sub"));
  await symlink("../secret", join(root, "sub", "link"));
  const result = await gitDiff(join(root, "sub"), "link", "untracked");
  expect(result.patch).toContain("+../secret");
  expect(result.patch).not.toContain("DO_NOT_READ_SECRET");
});

test("configured external diff is disabled", async () => {
  const root = await repo();
  await git(root, "config", "diff.external", "false");
  await writeFile(join(root, "tracked.txt"), "changed\n");
  expect((await gitDiff(root, "tracked.txt", "unstaged")).patch).toContain("+changed");
});
