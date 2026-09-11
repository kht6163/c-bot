import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  WorktreeError,
  addWorktree,
  gitRepoInfo,
  removeWorktree,
  worktreeDirty,
} from "../src/git-worktree.ts";

function git(cwd: string, ...args: string[]): string {
  const run = Bun.spawnSync(
    ["git", "-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args],
    { cwd },
  );
  if (run.exitCode !== 0) {
    throw new Error(run.stderr.toString());
  }
  return run.stdout.toString();
}

/** A repository with one commit, holding `app/a.txt`. */
async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cbot-wt-repo-"));
  git(dir, "init", "-q", "-b", "main");
  await mkdir(join(dir, "app"));
  await writeFile(join(dir, "app", "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null;
}

async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (err) {
    if (err instanceof WorktreeError) {
      return err.code;
    }
    throw err;
  }
  return "none";
}

describe("gitRepoInfo", () => {
  test("describes a repository, and says so when a folder is not one", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-wt-home-"));
    const dir = await repo();
    git(dir, "branch", "side");
    await writeFile(join(dir, "app", "a.txt"), "two\n");
    await writeFile(join(dir, "loose.txt"), "x\n");
    const info = await gitRepoInfo(dir, home);
    expect(info.repo).toBe(true);
    expect(info.branch).toBe("main");
    expect(info.head).toMatch(/^[0-9a-f]{4,}$/);
    expect(info.branches.sort()).toEqual(["main", "side"]);
    expect(info.changes).toBe(2);
    expect(info.worktreesDir?.startsWith(join(home, "worktrees"))).toBe(true);

    const plain = await mkdtemp(join(tmpdir(), "cbot-wt-plain-"));
    expect((await gitRepoInfo(plain, home)).repo).toBe(false);

    const empty = await mkdtemp(join(tmpdir(), "cbot-wt-empty-"));
    git(empty, "init", "-q", "-b", "main");
    const fresh = await gitRepoInfo(empty, home);
    expect(fresh.repo).toBe(true);
    expect(fresh.head).toBeNull();
  });
});

describe("addWorktree", () => {
  test("checks a new branch out at HEAD and works where the project sits in it", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-wt-home-"));
    const dir = await repo();
    await writeFile(join(dir, "app", "a.txt"), "uncommitted\n");
    const project = join(dir, "app");
    const added = await addWorktree({ home, project, branch: "cbot/fix" });

    expect(added.worktree.project).toBe(project);
    expect(added.worktree.branch).toBe("cbot/fix");
    expect(added.worktree.root.startsWith(join(home, "worktrees"))).toBe(true);
    expect(added.worktree.root.endsWith("/fix")).toBe(true);
    expect(added.workspace).toBe(join(added.worktree.root, "app"));
    expect(added.worktree.base).toBe(git(dir, "rev-parse", "HEAD").trim());
    expect(await Bun.file(join(added.workspace, "a.txt")).text()).toBe("one\n");
    expect(git(added.workspace, "branch", "--show-current").trim()).toBe("cbot/fix");

    // A second branch whose folder name is taken gets a numbered folder.
    const other = await addWorktree({ home, project, branch: "feature/fix" });
    expect(other.worktree.root).toBe(`${added.worktree.root}-2`);
  });

  test("refuses a taken or malformed branch, a plain folder, and a repository with no commit", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-wt-home-"));
    const dir = await repo();
    expect(await refusal(addWorktree({ home, project: dir, branch: "main" }))).toBe("branch_exists");
    expect(await refusal(addWorktree({ home, project: dir, branch: "bad..name" }))).toBe("invalid_branch");
    const plain = await mkdtemp(join(tmpdir(), "cbot-wt-plain-"));
    expect(await refusal(addWorktree({ home, project: plain, branch: "cbot/x" }))).toBe("not_repo");
    const empty = await mkdtemp(join(tmpdir(), "cbot-wt-empty-"));
    git(empty, "init", "-q", "-b", "main");
    expect(await refusal(addWorktree({ home, project: empty, branch: "cbot/x" }))).toBe("no_commits");
  });
});

describe("removeWorktree", () => {
  test("keeps a worktree holding work until forced, and drops a branch that never moved", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-wt-home-"));
    const dir = await repo();
    const { worktree, workspace } = await addWorktree({ home, project: dir, branch: "cbot/idle" });
    await writeFile(join(workspace, "draft.txt"), "wip\n");

    expect(await worktreeDirty(worktree.root)).toBe(true);
    expect(await removeWorktree(worktree)).toBe("dirty");
    expect(await exists(worktree.root)).toBe(true);

    expect(await removeWorktree(worktree, { force: true })).toBe("removed");
    expect(await exists(worktree.root)).toBe(false);
    expect(await exists(dirname(worktree.root))).toBe(false);
    expect(git(dir, "branch", "--list", "cbot/idle").trim()).toBe("");
    expect(await worktreeDirty(worktree.root)).toBe(false);
  });

  test("keeps the branch when the session committed on it", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-wt-home-"));
    const dir = await repo();
    const { worktree, workspace } = await addWorktree({ home, project: dir, branch: "cbot/done" });
    await writeFile(join(workspace, "b.txt"), "work\n");
    git(workspace, "add", "-A");
    git(workspace, "commit", "-qm", "work");

    expect(await removeWorktree(worktree)).toBe("removed");
    expect(await exists(worktree.root)).toBe(false);
    expect(git(dir, "branch", "--list", "cbot/done").trim()).toContain("cbot/done");
  });
});
