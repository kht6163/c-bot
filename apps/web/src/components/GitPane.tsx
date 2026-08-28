import { useEffect, useState } from "react";
import type { SessionId } from "@cbot/shared";
import { fetchGitStatus, type GitFileView, type GitStatusView } from "../lib/api.ts";

type Group = { key: string; label: string; files: GitFileView[]; column: "index" | "worktree" };

export function GitPane({ sessionId, refreshKey }: { sessionId: SessionId; refreshKey: number }) {
  const [git, setGit] = useState<GitStatusView | undefined>();
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    void fetchGitStatus(sessionId)
      .then(setGit)
      .catch((err: unknown) => {
        setGit(undefined);
        setError(err instanceof Error ? err.message : "git 상태를 읽지 못했습니다");
      });
  }, [sessionId, refreshKey]);

  if (error) {
    return <p className="hint danger">{error}</p>;
  }
  if (!git) {
    return <p className="empty">불러오는 중</p>;
  }
  if (!git.repo) {
    return <p className="empty">git 저장소가 아닙니다</p>;
  }

  const groups = groupFiles(git.files);

  return (
    <div className="git-pane">
      <div className="git-head">
        <span className="git-branch">{git.branch || "HEAD"}</span>
        {git.ahead > 0 ? <span className="git-count">↑{git.ahead}</span> : null}
        {git.behind > 0 ? <span className="git-count">↓{git.behind}</span> : null}
        <span className="git-upstream">{git.upstream ?? "업스트림 없음"}</span>
      </div>
      {groups.length === 0 ? (
        <p className="empty">깨끗한 작업 트리입니다</p>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="git-group">
            <p className="section-label">
              {group.label} {group.files.length}
            </p>
            <ul className="git-files">
              {group.files.map((file) => {
                const name = renameOf(file.path);
                return (
                  <li
                    key={`${group.key}:${file.path}`}
                    className="git-file"
                    title={`${file.label} · ${file.path}`}
                  >
                    <span className={`git-code ${toneOf(file, group.column)}`}>
                      {codeOf(file, group.column)}
                    </span>
                    <span className="git-name">{name.base}</span>
                    {name.dir ? <span className="git-dir">{name.dir}</span> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/**
 * `index` and `worktree` are the two porcelain columns: staged and unstaged.
 * A file changed in both shows up twice, which is what git actually reports.
 */
function groupFiles(files: readonly GitFileView[]): Group[] {
  const conflict = files.filter((file) => isConflict(file));
  const rest = files.filter((file) => !isConflict(file));
  const groups: Group[] = [
    { key: "conflict", label: "충돌", column: "worktree", files: conflict },
    {
      key: "staged",
      label: "스테이지됨",
      column: "index",
      files: rest.filter((file) => marked(file.index)),
    },
    {
      key: "worktree",
      label: "변경됨",
      column: "worktree",
      files: rest.filter((file) => marked(file.worktree)),
    },
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

function isConflict(file: GitFileView): boolean {
  const pair = `${file.index}${file.worktree}`;
  return pair === "UU" || pair === "AA" || pair === "DD" || file.index === "U" || file.worktree === "U";
}

function codeOf(file: GitFileView, column: Group["column"]): string {
  const code = (column === "index" ? file.index : file.worktree).trim();
  return code || "·";
}

/** A class name cannot carry `?`, so the porcelain letter maps to a tone. */
function toneOf(file: GitFileView, column: Group["column"]): string {
  const code = codeOf(file, column);
  if (code === "A") {
    return "tone-add";
  }
  if (code === "D" || code === "U") {
    return "tone-drop";
  }
  return code === "?" ? "tone-new" : "";
}

/**
 * The basename leads so it survives truncation at the 300px pane width; the
 * directory trails and is the part allowed to be cut. A rename shows its new
 * name — the old one stays in the row title.
 */
function renameOf(path: string): { dir: string; base: string } {
  const target = (path.includes(" -> ") ? path.split(" -> ").pop() : path) ?? path;
  const trimmed = target.replace(/\/$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut < 0
    ? { dir: "", base: trimmed }
    : { dir: trimmed.slice(0, cut), base: trimmed.slice(cut + 1) };
}
