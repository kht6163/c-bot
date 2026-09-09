import { useEffect, useState } from "react";
import type { GitDiffScope, GitDiffView, SessionId } from "@cbot/shared";
import { fetchGitDiff } from "../lib/api.ts";
import { diffLines } from "../lib/diff.ts";

export const DIFF_LABELS: Record<GitDiffScope, string> = {
  staged: "스테이지됨 · HEAD → 스테이지",
  unstaged: "변경됨 · 스테이지 → 작업 트리",
  untracked: "추적 안 함 · 새 파일",
};

export function GitDiff({ sessionId, path, scope, refreshKey }: {
  sessionId: SessionId;
  path: string;
  scope: GitDiffScope;
  refreshKey: number;
}) {
  const [diff, setDiff] = useState<GitDiffView>();
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setDiff(undefined);
    setError("");
    void fetchGitDiff(sessionId, path, scope).then(next => {
      if (live) setDiff(next);
    }).catch((err: unknown) => {
      if (live) setError(err instanceof Error ? err.message : "변경사항을 읽지 못했습니다");
    });
    return () => { live = false; };
  }, [sessionId, path, scope, refreshKey]);

  const lines = diff ? diffLines(diff.patch) : [];
  const added = lines.filter(line => line.kind === "add").length;
  const removed = lines.filter(line => line.kind === "remove").length;
  const combined = diff?.patch.includes("\n@@@") ?? false;
  return (
    <section className="git-diff" aria-label={`${path} 변경사항`}>
      <div className="git-diff-heading">
        <span>{combined ? "충돌 · 병합 diff" : DIFF_LABELS[scope]}</span>
        {diff && !diff.binary && !combined ? <span className="git-stat">{diff.truncated ? "표시된 줄 " : ""}+{added} −{removed}</span> : null}
      </div>
      {error ? <p className="hint danger" role="alert">{error}</p> : !diff ? (
        <p className="empty" role="status">변경사항을 불러오는 중</p>
      ) : diff.binary ? (
        <p className="empty">바이너리 파일은 줄 단위로 비교할 수 없습니다</p>
      ) : lines.length === 0 ? (
        <p className="empty">표시할 텍스트 변경이 없습니다</p>
      ) : (
        <div className="git-diff-scroll" tabIndex={0} aria-label="줄 단위 diff">
          <table className="git-diff-table">
            <thead className="sr-only"><tr><th>이전 줄</th><th>이후 줄</th><th>내용</th></tr></thead>
            <tbody>{lines.map((line, index) => (
              <tr key={index} className={`diff-${line.kind}`}>
                <td className="diff-number">{line.before ?? ""}</td>
                <td className="diff-number">{line.after ?? ""}</td>
                <td className="diff-source">{line.text}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {diff?.truncated ? <p className="hint">변경량이 커서 일부만 표시합니다</p> : null}
    </section>
  );
}
