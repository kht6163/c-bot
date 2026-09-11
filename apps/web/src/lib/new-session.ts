import { isBranchName, worktreeFolderName } from "@cbot/shared";

/** Branches c-bot suggests sit apart from the user's own. */
export const BRANCH_PREFIX = "cbot/";

/**
 * A branch for a new worktree: the session name in ASCII, else the minute the
 * dialog opened, with a number added while the name is taken.
 */
export function suggestBranch(title: string, taken: readonly string[], now: Date): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  const stem = `${BRANCH_PREFIX}${slug || stamp(now)}`;
  const names = new Set(taken);
  if (!names.has(stem)) {
    return stem;
  }
  let n = 2;
  while (names.has(`${stem}-${n}`)) {
    n += 1;
  }
  return `${stem}-${n}`;
}

function stamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** Why a branch name cannot be used, as UI copy; null when it can. */
export function branchProblem(branch: string, taken: readonly string[]): string | null {
  const name = branch.trim();
  if (name.length === 0) {
    return "브랜치 이름을 적어 주세요";
  }
  if (!isBranchName(name)) {
    return "브랜치 이름으로 쓸 수 없습니다";
  }
  if (taken.includes(name)) {
    return "이미 있는 브랜치입니다";
  }
  // Git keeps refs as paths: `a` and `a/b` cannot both be branches.
  if (taken.some((other) => name.startsWith(`${other}/`) || other.startsWith(`${name}/`))) {
    return "이미 있는 브랜치와 경로가 겹칩니다";
  }
  return null;
}

/** Where the worktree would go. The server adds a number when that folder is already there. */
export function worktreePreview(dir: string, branch: string): string {
  return `${dir.replace(/\/+$/, "")}/${worktreeFolderName(branch.trim())}`;
}
