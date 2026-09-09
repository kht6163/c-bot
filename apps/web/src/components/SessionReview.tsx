import { useEffect, useState } from "react";
import type { SessionId } from "@cbot/shared";
import { fetchSessionReview, type SessionReviewView } from "../lib/api.ts";

export function SessionReview({ sessionId, refreshKey }: { sessionId: SessionId; refreshKey: number }) {
  const [review, setReview] = useState<SessionReviewView>();
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setError("");
    void fetchSessionReview(sessionId).then(next => {
      if (live) setReview(next);
    }).catch((err: unknown) => {
      if (live) setError(err instanceof Error ? err.message : "세션 변경 기록을 읽지 못했습니다");
    });
    return () => { live = false; };
  }, [sessionId, refreshKey]);
  return (
    <details className="git-group session-review" open>
      <summary className="section-label git-summary">세션 변경 기록{review ? ` · 파일 ${review.files.length}` : ""}</summary>
      <p className="git-review-note">리드와 전문 봇의 성공한 파일 수정 기록입니다. 현재 Git diff에는 기존 변경과 다른 세션의 변경도 포함됩니다.</p>
      {error ? <p className="hint danger" role="alert">{error}</p> : !review ? (
        <p className="empty">불러오는 중</p>
      ) : (
        <>
          {review.files.length === 0 ? <p className="empty">파일 수정 도구 기록이 없습니다</p> : (
            <ul className="git-files">{review.files.map(file => (
              <li className="git-file" key={file.path} title={file.path}>
                <span className="git-name">{file.path}</span>
                <span className="git-stat">쓰기 {file.writes} · 편집 {file.edits}</span>
              </li>
            ))}</ul>
          )}
          {review.shellCommands > 0 ? <p className="git-review-note">셸 실행 {review.shellCommands}회 · 셸로 수정한 파일은 위 목록에 집계되지 않습니다.</p> : null}
        </>
      )}
    </details>
  );
}
