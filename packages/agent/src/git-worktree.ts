import { mkdir, rmdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  isBranchName,
  worktreeFolderName,
  type GitRepoInfo,
  type SessionWorktree,
} from "@cbot/shared";

export type WorktreeErrorCode =
  | "not_repo"
  | "no_commits"
  | "invalid_branch"
  | "branch_exists"
  | "git_failed";

/** Why a worktree could not be made or removed. The message is UI copy. */
export class WorktreeError extends Error {
  constructor(
    readonly code: WorktreeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorktreeError";
  }
}

/** Every worktree c-bot makes lives here: a folder per repository, a folder per branch inside. */
export function worktreesDir(home: string, repoTop: string): string {
  return join(home, "worktrees", basename(repoTop));
}

export async function gitRepoInfo(dir: string, home: string): Promise<GitRepoInfo> {
  const top = await runGit(dir, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) {
    return { repo: false, branch: null, head: null, branches: [], changes: 0, worktreesDir: null };
  }
  const [head, branch, branches, status] = await Promise.all([
    runGit(dir, ["rev-parse", "--verify", "--quiet", "--short", "HEAD"]),
    runGit(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    runGit(dir, ["for-each-ref", "--format=%(refname:lstrip=2)", "refs/heads"]),
    // Counted file by file, as the Git panel counts them.
    runGit(dir, ["status", "--porcelain", "--untracked-files=all", "--", "."]),
  ]);
  return {
    repo: true,
    branch: branch.ok ? branch.out.trim() || null : null,
    head: head.ok ? head.out.trim() || null : null,
    branches: branches.ok ? lines(branches.out) : [],
    changes: status.ok ? lines(status.out).length : 0,
    worktreesDir: worktreesDir(home, top.out.trim()),
  };
}

export interface AddedWorktree {
  /** Where the session works: the project's own place inside the new checkout. */
  workspace: string;
  worktree: SessionWorktree;
}

/**
 * Checks out a new branch at the project's HEAD into a folder of its own.
 * Uncommitted changes in the project stay where they are.
 */
export async function addWorktree(input: {
  home: string;
  project: string;
  branch: string;
}): Promise<AddedWorktree> {
  const { home, project, branch } = input;
  if (!isBranchName(branch)) {
    throw new WorktreeError("invalid_branch", "브랜치 이름으로 쓸 수 없습니다");
  }
  const top = await runGit(project, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) {
    throw new WorktreeError("not_repo", "git 저장소가 아닙니다");
  }
  const [prefix, head, taken] = await Promise.all([
    runGit(project, ["rev-parse", "--show-prefix"]),
    runGit(project, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]),
    runGit(project, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]),
  ]);
  if (!head.ok) {
    throw new WorktreeError("no_commits", "커밋이 없어 워크트리를 만들 수 없습니다");
  }
  if (taken.ok) {
    throw new WorktreeError("branch_exists", "이미 있는 브랜치입니다");
  }
  const base = head.out.trim();
  const parent = worktreesDir(home, top.out.trim());
  await mkdir(parent, { recursive: true });
  const root = await freeFolder(parent, worktreeFolderName(branch));
  const added = await runGit(project, ["worktree", "add", "-b", branch, root, base]);
  if (!added.ok) {
    throw new WorktreeError("git_failed", gitMessage(added.err, "워크트리를 만들지 못했습니다"));
  }
  const workspace = resolve(root, prefix.out.trim());
  // A project folder the commit does not hold (untracked, ignored) has no copy in the checkout yet.
  await mkdir(workspace, { recursive: true });
  return { workspace, worktree: { project, branch, root, base } };
}

/**
 * Uncommitted or untracked files in a checkout. A checkout git cannot read
 * counts as holding work; one that is gone holds nothing.
 */
export async function worktreeDirty(root: string): Promise<boolean> {
  if (!(await isDirectory(root))) {
    return false;
  }
  const status = await runGit(root, ["status", "--porcelain"]);
  return !status.ok || status.out.trim().length > 0;
}

/**
 * Takes a session's worktree off disk, or reports `dirty` and leaves it while
 * it holds uncommitted work and `force` is not set. The branch stays when it
 * has commits of its own; one still at its starting commit goes with the folder.
 */
export async function removeWorktree(
  worktree: SessionWorktree,
  options: { force?: boolean } = {},
): Promise<"removed" | "dirty"> {
  if (!(await isDirectory(worktree.project))) {
    // Git cannot remove a checkout whose repository is gone; the folder is left as it is.
    return "removed";
  }
  if (await isDirectory(worktree.root)) {
    if (!options.force && (await worktreeDirty(worktree.root))) {
      return "dirty";
    }
    // The status check above already decided; --force also takes a checkout with submodules.
    const removed = await runGit(worktree.project, ["worktree", "remove", "--force", worktree.root]);
    if (!removed.ok) {
      throw new WorktreeError("git_failed", gitMessage(removed.err, "워크트리를 지우지 못했습니다"));
    }
    await rmdir(dirname(worktree.root)).catch(() => {
      // The repository's folder still holds other worktrees; it stays.
    });
  } else {
    await runGit(worktree.project, ["worktree", "prune"]);
  }
  const tip = await runGit(worktree.project, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${worktree.branch}`,
  ]);
  if (tip.ok && tip.out.trim() === worktree.base) {
    await runGit(worktree.project, ["branch", "-D", worktree.branch]);
  }
  return "removed";
}

async function freeFolder(parent: string, name: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const path = join(parent, n === 1 ? name : `${name}-${n}`);
    if (!(await stat(path).catch(() => null))) {
      return path;
    }
  }
  throw new WorktreeError("git_failed", "워크트리 폴더 이름을 정하지 못했습니다");
}

async function isDirectory(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info?.isDirectory() ?? false;
}

function lines(out: string): string[] {
  return out.split("\n").filter((line) => line.length > 0);
}

/** Git's own first line without the `fatal:` prefix, or the fallback when it said nothing. */
function gitMessage(err: string, fallback: string): string {
  const first = err.split("\n").find((line) => line.trim().length > 0) ?? "";
  return first.replace(/^(fatal|error):\s*/, "").trim() || fallback;
}

// Without core.quotePath=false git C-escapes every non-ASCII path; a missing
// folder is a failed call, not a crash.
async function runGit(cwd: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const proc = Bun.spawn(["git", "-c", "core.quotePath=false", ...args], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: code === 0, out, err };
  } catch (error) {
    return { ok: false, out: "", err: error instanceof Error ? error.message : String(error) };
  }
}
