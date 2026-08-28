import { useEffect, useState } from "react";
import type { SessionId } from "@cbot/shared";
import { fetchGitStatus, type GitStatusView } from "../lib/api.ts";
import { codeOf, groupFiles, splitPath, toneOf } from "../lib/git-rows.ts";

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
    </div>
  );
}
