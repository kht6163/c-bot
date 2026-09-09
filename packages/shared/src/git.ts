export type GitDiffScope = "staged" | "unstaged" | "untracked";

export interface GitDiffView {
  path: string;
  patch: string;
  truncated: boolean;
  binary: boolean;
}
