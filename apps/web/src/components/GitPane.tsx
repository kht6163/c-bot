import { useEffect, useState } from "react";
import type { SessionId } from "@cbot/shared";
import { fetchGitStatus, type GitCommitView, type GitStatusView } from "../lib/api.ts";
import { codeOf, commitDate, groupFiles, groupRefs, splitPath, toneOf } from "../lib/git-rows.ts";

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
  const refGroups = groupRefs(git.refs);

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
                const name = splitPath(file);
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
      {refGroups.map((group) => (
        <details key={group.key} className="git-group" open={group.key === "local"}>
          <summary className="section-label git-summary">
            {group.label} {group.refs.length}
          </summary>
          <ul className="git-refs">
            {group.refs.map((ref) => (
              <li
                key={`${group.key}:${ref.name}`}
                className={ref.head ? "git-ref current" : "git-ref"}
                title={ref.upstream ? `${ref.name} → ${ref.upstream}` : ref.name}
              >
                <span className="git-ref-mark">{ref.head ? "✓" : ""}</span>
                <span className="git-ref-name">{ref.name}</span>
                <span className="git-sha">{ref.sha}</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
      <section className="git-group">
        <p className="section-label">커밋</p>
        {git.commits.length === 0 ? (
          <p className="empty">커밋이 없습니다</p>
        ) : (
          <ul className="git-commits">
            {git.commits.map((commit) => (
              <CommitRow key={commit.sha} commit={commit} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CommitRow({ commit }: { commit: GitCommitView }) {
  return (
    <li className="git-commit" title={`${commit.short} · ${commit.author}\n${commit.subject}`}>
      {commit.refs.length > 0 ? (
        <p className="git-commit-refs">
          {commit.refs.map((ref) => (
            <span key={ref} className="git-ref-badge">
              {ref}
            </span>
          ))}
        </p>
      ) : null}
      <p className="git-commit-head">
        <span className="git-commit-subject">{commit.subject}</span>
      </p>
      <p className="git-commit-meta">
        <span className="git-sha">{commit.short}</span>
        <span className="git-commit-author">{commit.author}</span>
        <span className="git-commit-date">{commitDate(commit.date)}</span>
      </p>
    </li>
  );
}
