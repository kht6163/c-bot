export type GitDiffScope = "staged" | "unstaged" | "untracked";

export interface GitDiffView {
  path: string;
  patch: string;
  truncated: boolean;
  binary: boolean;
}

/** A project folder as the new-session dialog sees it. */
export interface GitRepoInfo {
  repo: boolean;
  /** The branch HEAD is on; null when HEAD is detached or the folder is not a repository. */
  branch: string | null;
  /** Short name of the commit HEAD is at; null until the repository has a commit. */
  head: string | null;
  /** Local branch names, so a taken name is refused before the server is asked. */
  branches: string[];
  /** Changed files in the project folder. A worktree starts from HEAD, so they stay behind. */
  changes: number;
  /** Folder new worktrees of this repository go under. */
  worktreesDir: string | null;
}

/**
 * `git check-ref-format --branch`, written out so the browser and the server
 * can refuse a name before git is asked.
 */
export function isBranchName(name: string): boolean {
  if (name.length === 0 || name === "HEAD" || name.startsWith("-")) {
    return false;
  }
  if (name.startsWith("/") || name.endsWith("/") || name.endsWith(".") || name.includes("//")) {
    return false;
  }
  if (name.includes("..") || name.includes("@{") || /[\x00-\x20\x7f~^:?*[\\]/.test(name)) {
    return false;
  }
  return name.split("/").every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
}

/** The folder a branch's worktree is named after: its last path segment. */
export function worktreeFolderName(branch: string): string {
  return branch.split("/").filter((part) => part.length > 0).at(-1) ?? branch;
}
