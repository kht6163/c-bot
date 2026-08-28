import { useEffect, useState } from "react";
import type { SessionId } from "@cbot/shared";
import { fetchGitStatus, type GitStatusView } from "../lib/api.ts";

export function GitPane({ sessionId, refreshKey }: { sessionId: SessionId; refreshKey: number }) {
  const [git, setGit] = useState<GitStatusView | undefined>();
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    void fetchGitStatus(sessionId)
      .then(setGit)
      .catch((err: unknown) => {
        setGit(undefined);
        setError(err instanceof Error ? err.message : "failed");
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
  return (
    <div className="git-pane">
      <p className="git-branch">
        {git.branch || "HEAD"}
        {git.upstream ? ` → ${git.upstream}` : ""}
        {git.ahead > 0 ? ` +${git.ahead}` : ""}
        {git.behind > 0 ? ` −${git.behind}` : ""}
      </p>
      {git.files.length === 0 ? (
        <p className="empty">깨끗한 작업 트리입니다</p>
      ) : (
        <ul className="git-files">
          {git.files.map((file) => (
            <li key={file.path}>
              <span className="git-label">{file.label}</span>
              <span className="git-path">{file.path}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
