export interface GitFile {
  path: string;
  index: string;
  worktree: string;
  label: string;
}

export interface GitStatusView {
  repo: boolean;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
}

export type GitRefKind = "local" | "remote" | "tag";

export interface GitRef {
  name: string;
  kind: GitRefKind;
  head: boolean;
  sha: string;
  upstream: string | null;
}

export interface GitCommit {
  sha: string;
  short: string;
  subject: string;
  author: string;
  date: string;
  refs: string[];
}

export interface GitCommitFile {
  path: string;
  /** `null` on a binary file, which numstat reports as `-`. */
  added: number | null;
  removed: number | null;
}

export interface GitCommitDetail extends GitCommit {
  email: string;
  body: string;
  files: GitCommitFile[];
}

/** Status plus the two read-only views the panel draws beside it. */
export interface GitView extends GitStatusView {
  refs: GitRef[];
  commits: GitCommit[];
}

export function parseGitStatus(out: string): Omit<GitStatusView, "repo"> {
  const files: GitFile[] = [];
  let branch = "";
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  for (const line of out.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    if (line.startsWith("## ")) {
      const rest = line.slice(3);
      ahead = Number(/\[ahead (\d+)/.exec(rest)?.[1] ?? 0);
      behind = Number(/behind (\d+)/.exec(rest)?.[1] ?? 0);
      const noMeta = rest.replace(/\s*\[.*$/, "").trim();
      const parts = noMeta.split("...");
      branch = parts[0] ?? "";
      upstream = parts[1] && parts[1].length > 0 ? parts[1] : null;
      continue;
    }
    const index = line[0] ?? " ";
    const worktree = line[1] ?? " ";
    const path = line.slice(3);
    if (path.length === 0) {
      continue;
    }
    files.push({ path, index, worktree, label: gitLabel(index, worktree) });
  }
  return { branch, upstream, ahead, behind, files };
}

const REF_FORMAT = "%(refname)\t%(refname:short)\t%(objectname:short)\t%(upstream:short)\t%(HEAD)";

/**
 * `refs/remotes/<remote>/HEAD` is a symbolic alias for another row, so it is
 * dropped: the panel lists real branches, not the pointer to the default one.
 */
export function parseGitRefs(out: string): GitRef[] {
  const refs: GitRef[] = [];
  for (const line of out.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const [refname = "", name = "", sha = "", upstream = "", head = ""] = line.split("\t");
    const kind = refKind(refname);
    if (!kind || name.length === 0 || refname.endsWith("/HEAD")) {
      continue;
    }
    refs.push({
      name,
      kind,
      head: head.trim() === "*",
      sha,
      upstream: upstream.length > 0 ? upstream : null,
    });
  }
  return refs;
}

const LOG_FORMAT = "%H\t%h\t%an\t%aI\t%D\t%s";

/** The subject is last so a tab inside it cannot shift the fields before it. */
export function parseGitLog(out: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const line of out.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const parts = line.split("\t");
    const [sha = "", short = "", author = "", date = "", decoration = ""] = parts;
    if (sha.length === 0) {
      continue;
    }
    commits.push({
      sha,
      short,
      author,
      date,
      refs: parseDecoration(decoration),
      subject: parts.slice(5).join("\t"),
    });
  }
  return commits;
}

/** `%D` prints `HEAD -> main, origin/main, tag: v1`; only the names are kept. */
function parseDecoration(decoration: string): string[] {
  return decoration
    .split(", ")
    .map((item) => item.trim().replace(/^HEAD -> /, "").replace(/^tag: /, ""))
    .filter((item) => item.length > 0);
}

function refKind(refname: string): GitRefKind | undefined {
  if (refname.startsWith("refs/heads/")) {
    return "local";
  }
  if (refname.startsWith("refs/remotes/")) {
    return "remote";
  }
  return refname.startsWith("refs/tags/") ? "tag" : undefined;
}

// Unit separators keep a multi-line body from being mistaken for a new field.
const SHOW_FORMAT = "%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s%x1f%b";

export function parseGitShow(out: string): Omit<GitCommitDetail, "files"> | undefined {
  const [sha, short, author, email, date, decoration, subject, body] = out.split("\x1f");
  if (!sha || sha.length === 0) {
    return undefined;
  }
  return {
    sha,
    short: short ?? "",
    author: author ?? "",
    email: email ?? "",
    date: date ?? "",
    refs: parseDecoration(decoration ?? ""),
    subject: subject ?? "",
    body: (body ?? "").trim(),
  };
}

/** numstat prints `added\tremoved\tpath`, with `-` for a binary file. */
export function parseGitNumstat(out: string): GitCommitFile[] {
  const files: GitCommitFile[] = [];
  for (const line of out.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const [added = "", removed = "", ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (path.length === 0) {
      continue;
    }
    files.push({ path, added: countOf(added), removed: countOf(removed) });
  }
  return files;
}

function countOf(field: string): number | null {
  const value = Number(field);
  return field === "-" || Number.isNaN(value) ? null : value;
}

/**
 * A revision reaches this from the browser, so only a hex object name is
 * accepted: no ranges, no `--flags`, no `..` walks.
 */
export function isCommitSha(sha: string): boolean {
  return /^[0-9a-f]{4,40}$/.test(sha);
}

export async function gitCommit(
  workspace: string,
  sha: string,
): Promise<GitCommitDetail | undefined> {
  if (!isCommitSha(sha)) {
    return undefined;
  }
  const [head, numstat] = await Promise.all([
    runGit(workspace, ["show", "--no-patch", `--format=${SHOW_FORMAT}`, sha]),
    // A merge commit lists no files here, which is the honest empty answer.
    runGit(workspace, ["show", "--numstat", "--format=", sha]),
  ]);
  if (!head.ok) {
    return undefined;
  }
  const detail = parseGitShow(head.out);
  return detail ? { ...detail, files: numstat.ok ? parseGitNumstat(numstat.out) : [] } : undefined;
}

export async function gitStatus(workspace: string): Promise<GitStatusView> {
  const status = await runGit(workspace, ["status", "--porcelain=v1", "-b"]);
  if (!status.ok) {
    return emptyStatus();
  }
  return { repo: true, ...parseGitStatus(status.out) };
}

export async function gitView(workspace: string, logLimit = 60): Promise<GitView> {
  const status = await gitStatus(workspace);
  if (!status.repo) {
    return { ...status, refs: [], commits: [] };
  }
  // A fresh repo has no commits, so `log` exits non-zero; the panel still draws
  // the status and refs it does have.
  const [refs, log] = await Promise.all([
    runGit(workspace, [
      "for-each-ref",
      "--sort=-committerdate",
      `--format=${REF_FORMAT}`,
      "refs/heads",
      "refs/remotes",
      "refs/tags",
    ]),
    runGit(workspace, ["log", `--max-count=${logLimit}`, `--format=${LOG_FORMAT}`]),
  ]);
  return {
    ...status,
    refs: refs.ok ? parseGitRefs(refs.out) : [],
    commits: log.ok ? parseGitLog(log.out) : [],
  };
}

function emptyStatus(): GitStatusView {
  return { repo: false, branch: "", upstream: null, ahead: 0, behind: 0, files: [] };
}

// Without core.quotePath=false git C-escapes every non-ASCII path, so a Korean
// filename would reach the UI as an octal C-escape, not text.
async function runGit(workspace: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const proc = Bun.spawn(["git", "-c", "core.quotePath=false", ...args], {
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, , code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, out };
}

function gitLabel(index: string, worktree: string): string {
  const code = `${index}${worktree}`;
  if (code === "??") {
    return "추적 안 함";
  }
  if (index === "A" || worktree === "A") {
    return "추가";
  }
  if (index === "D" || worktree === "D") {
    return "삭제";
  }
  if (index === "R" || worktree === "R") {
    return "이름 변경";
  }
  if (index === "M" || worktree === "M") {
    return "수정";
  }
  return code.trim() || "변경";
}
