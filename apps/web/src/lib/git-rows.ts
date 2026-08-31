import type { GitCommitFileView, GitFileView, GitRefKind, GitRefView } from "./api.ts";

export type GitColumn = "index" | "worktree";

export interface GitGroup {
  key: string;
  label: string;
  column: GitColumn;
  files: GitFileView[];
}

/**
 * `index` and `worktree` are the two porcelain columns: staged and unstaged.
 * A file changed in both shows up in both groups, which is what git reports.
 */
export function groupFiles(files: readonly GitFileView[]): GitGroup[] {
  const conflict = files.filter((file) => isConflict(file));
  const rest = files.filter((file) => !isConflict(file));
  const groups: GitGroup[] = [
    { key: "conflict", label: "충돌", column: "worktree", files: conflict },
    { key: "staged", label: "스테이지됨", column: "index", files: rest.filter((f) => marked(f.index)) },
    { key: "worktree", label: "변경됨", column: "worktree", files: rest.filter((f) => marked(f.worktree)) },
    {
      key: "untracked",
      label: "추적 안 함",
      column: "worktree",
      files: rest.filter((file) => file.index === "?" && file.worktree === "?"),
    },
  ];
  return groups.filter((group) => group.files.length > 0);
}

function marked(code: string): boolean {
  return code.trim().length > 0 && code !== "?";
}

export function isConflict(file: GitFileView): boolean {
  const pair = `${file.index}${file.worktree}`;
  return pair === "UU" || pair === "AA" || pair === "DD" || file.index === "U" || file.worktree === "U";
}

export function codeOf(file: GitFileView, column: GitColumn): string {
  const code = (column === "index" ? file.index : file.worktree).trim();
  return code || "·";
}

/** A class name cannot carry `?`, so the porcelain letter maps to a tone. */
export function toneOf(file: GitFileView, column: GitColumn): string {
  const code = codeOf(file, column);
  if (code === "A") {
    return "tone-add";
  }
  if (code === "D" || code === "U") {
    return "tone-drop";
  }
  if (code === "M") {
    return "tone-mod";
  }
  return code === "?" ? "tone-new" : "";
}

/**
 * The basename leads so it survives truncation at the narrow pane width; the
 * directory trails and is the part allowed to be cut. A rename shows its new
 * name — the original stays in the row title. Only R and C print
 * `ORIG -> PATH`, so an arrow in any other row belongs to the filename.
 */
export function splitPath(file: GitFileView): { dir: string; base: string } {
  const renamed = isRename(file.index) || isRename(file.worktree);
  const arrow = renamed ? file.path.indexOf(" -> ") : -1;
  return splitPathText(arrow < 0 ? file.path : file.path.slice(arrow + 4));
}

export function splitPathText(path: string): { dir: string; base: string } {
  const trimmed = path.replace(/\/$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut < 0
    ? { dir: "", base: trimmed }
    : { dir: trimmed.slice(0, cut), base: trimmed.slice(cut + 1) };
}

function isRename(code: string): boolean {
  return code === "R" || code === "C";
}

export interface GitRefGroup {
  key: GitRefKind;
  label: string;
  refs: GitRefView[];
}

const REF_LABELS: Record<GitRefKind, string> = {
  local: "브랜치",
  remote: "리모트",
  tag: "태그",
};

/** The checked-out branch leads its group; the rest keep git's recency order. */
export function groupRefs(refs: readonly GitRefView[]): GitRefGroup[] {
  const kinds: GitRefKind[] = ["local", "remote", "tag"];
  return kinds
    .map((kind) => {
      const mine = refs.filter((ref) => ref.kind === kind);
      const head = mine.filter((ref) => ref.head);
      return { key: kind, label: REF_LABELS[kind], refs: [...head, ...mine.filter((ref) => !ref.head)] };
    })
    .filter((group) => group.refs.length > 0);
}

/**
 * The pane is narrow, so a commit date spends no room on the time. This year
 * prints month and day; an older commit adds the year it belongs to.
 */
export function commitDate(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return "";
  }
  const month = at.getMonth() + 1;
  const day = at.getDate();
  return at.getFullYear() === now.getFullYear()
    ? `${month}월 ${day}일`
    : `${at.getFullYear()}. ${month}. ${day}.`;
}

/** numstat has no count for a binary file, so the row says so instead of `+0 −0`. */
export function commitStat(file: GitCommitFileView): string {
  return file.added === null || file.removed === null
    ? "바이너리"
    : `+${file.added} −${file.removed}`;
}
