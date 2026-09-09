import { useEffect, useState } from "react";
import type { GitDiffScope, SessionId } from "@cbot/shared";
import { GitDiff } from "./GitDiff.tsx";
import { SessionReview } from "./SessionReview.tsx";
import {
  fetchGitCommit,
  fetchGitStatus,
  type GitCommitDetailView,
  type GitCommitView,
  type GitStatusView,
} from "../lib/api.ts";
import {
  codeOf,
  commitDate,
  commitStat,
  groupFiles,
  groupRefs,
  splitPath,
  splitPathText,
  toneOf,
} from "../lib/git-rows.ts";

export function GitPane({ sessionId, refreshKey }: { sessionId: SessionId; refreshKey: number }) {
  return <GitPaneContent key={sessionId} sessionId={sessionId} refreshKey={refreshKey} />;
}

function GitPaneContent({ sessionId, refreshKey }: { sessionId: SessionId; refreshKey: number }) {
  const [git, setGit] = useState<GitStatusView | undefined>();
  const [error, setError] = useState("");
  const [openSha, setOpenSha] = useState("");
  const [selected, setSelected] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setError("");
    void fetchGitStatus(sessionId)
      .then(next => { if (live) setGit(next); })
      .catch((err: unknown) => {
        if (!live) return;
        setGit(undefined);
        setError(err instanceof Error ? err.message : "git 상태를 읽지 못했습니다");
      });
    return () => { live = false; };
  }, [sessionId, refreshKey, reload]);

  if (error) {
    return <><p className="hint danger" role="alert">{error}</p><button type="button" className="ghost" onClick={() => setReload(n => n + 1)}>다시 시도</button></>;
  }
  if (!git) {
    return <p className="empty">불러오는 중</p>;
  }
  if (!git.repo) {
    return <><SessionReview sessionId={sessionId} refreshKey={refreshKey + reload} /><p className="empty">git 저장소가 아닙니다</p></>;
  }

  const groups = groupFiles(git.files);
  const refGroups = groupRefs(git.refs);

  return (
    <div className="git-pane">
      <div className="git-review-toolbar">
        <span className="section-label">변경사항 리뷰 · 파일 {git.files.length}</span>
        <button type="button" className="ghost" onClick={() => setReload(n => n + 1)}>새로고침</button>
      </div>
      <SessionReview sessionId={sessionId} refreshKey={refreshKey + reload} />
      <div className="git-head">
        <BranchIcon />
        <span className="git-branch">{git.branch || "HEAD"}</span>
        {git.ahead > 0 ? <span className="git-count ahead">↑{git.ahead}</span> : null}
        {git.behind > 0 ? <span className="git-count behind">↓{git.behind}</span> : null}
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
                const selection = `${group.key}:${file.path}`;
                const open = selected === selection;
                const scope: GitDiffScope = group.key === "staged" ? "staged" : group.key === "untracked" ? "untracked" : "unstaged";
                return (
                  <li
                    key={selection}
                  >
                    <button type="button" className={open ? "git-file git-file-button selected" : "git-file git-file-button"}
                      title={`${file.label} · ${file.originalPath ? `${file.originalPath} → ` : ""}${file.path}`}
                      aria-label={`${group.label}: ${file.path}`}
                      aria-expanded={open} onClick={() => setSelected(open ? "" : selection)}>
                    <span className={`git-code ${toneOf(file, group.column)}`}>
                      {codeOf(file, group.column)}
                    </span>
                    <span className="git-name">{name.base}</span>
                    {name.dir ? <span className="git-dir">{name.dir}</span> : null}
                    </button>
                    {open ? <GitDiff key={selection} sessionId={sessionId} path={file.path} scope={scope} refreshKey={refreshKey + reload} /> : null}
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
              <CommitRow
                key={commit.sha}
                sessionId={sessionId}
                commit={commit}
                open={commit.sha === openSha}
                onToggle={() => setOpenSha(commit.sha === openSha ? "" : commit.sha)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BranchIcon() {
  return (
    <svg className="git-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <g stroke="var(--accent)" strokeWidth="1.3">
        <circle cx="4" cy="3.4" r="1.7" />
        <circle cx="4" cy="10.6" r="1.7" />
        <circle cx="10.2" cy="3.4" r="1.7" />
        <path d="M4 5.1v3.8M10.2 5.1c0 2.4-1.9 3.1-4.4 3.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function CommitRow({
  sessionId,
  commit,
  open,
  onToggle,
}: {
  sessionId: SessionId;
  commit: GitCommitView;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li className={open ? "git-commit open" : "git-commit"}>
      <button type="button" className="git-commit-btn" aria-expanded={open} onClick={onToggle}>
        {commit.refs.length > 0 ? (
          <span className="git-commit-refs">
            {commit.refs.map((ref) => (
              <span key={ref} className="git-ref-badge">
                {ref}
              </span>
            ))}
          </span>
        ) : null}
        <span className="git-commit-head">
          <span className="git-commit-subject">{commit.subject}</span>
        </span>
        <span className="git-commit-meta">
          <span className="git-sha">{commit.short}</span>
          <span className="git-commit-author">{commit.author}</span>
          <span className="git-commit-date">{commitDate(commit.date)}</span>
        </span>
      </button>
      {open ? <CommitDetail sessionId={sessionId} sha={commit.sha} /> : null}
    </li>
  );
}

function CommitDetail({ sessionId, sha }: { sessionId: SessionId; sha: string }) {
  const [detail, setDetail] = useState<GitCommitDetailView | undefined>();
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setError("");
    setDetail(undefined);
    void fetchGitCommit(sessionId, sha)
      .then((next) => {
        if (live) {
          setDetail(next);
        }
      })
      .catch((err: unknown) => {
        if (live) {
          setError(err instanceof Error ? err.message : "커밋을 읽지 못했습니다");
        }
      });
    return () => {
      live = false;
    };
  }, [sessionId, sha]);

  if (error) {
    return <p className="hint danger git-detail">{error}</p>;
  }
  if (!detail) {
    return <p className="empty git-detail">불러오는 중</p>;
  }

  return (
    <div className="git-detail">
      <p className="git-detail-line">
        <span className="git-detail-author">{detail.author}</span>
        <span className="git-detail-email">{detail.email}</span>
      </p>
      <p className="git-detail-line">
        <span className="git-sha">{detail.sha}</span>
      </p>
      {detail.body ? <p className="git-detail-body">{detail.body}</p> : null}
      <p className="section-label git-detail-label">파일 {detail.files.length}</p>
      {detail.files.length === 0 ? (
        <p className="empty">바뀐 파일이 없습니다</p>
      ) : (
        <ul className="git-files">
          {detail.files.map((file) => {
            const name = splitPathText(file.path);
            return (
              <li key={file.path} className="git-file" title={file.path}>
                <span className="git-name">{name.base}</span>
                {name.dir ? <span className="git-dir">{name.dir}</span> : null}
                <span className="git-stat">{commitStat(file)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
