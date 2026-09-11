import { useEffect, useRef, useState } from "react";
import {
  SESSION_TITLE_MAX,
  normalizeSessionTitle,
  type GitRepoInfo,
  type SessionSummary,
} from "@cbot/shared";
import { createSession, fetchRepoInfo } from "../lib/api.ts";
import { isImeKeyboardEvent } from "../lib/ime.ts";
import { branchProblem, suggestBranch, worktreePreview } from "../lib/new-session.ts";
import { folderName, homePath } from "../lib/path.ts";

interface Props {
  /** The project folder the session is made in. */
  project: string;
  onClose: () => void;
  onCreated: (session: SessionSummary) => void;
}

export function NewSessionDialog({ project, onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [repo, setRepo] = useState<GitRepoInfo | "loading" | "error">("loading");
  const [useWorktree, setUseWorktree] = useState(false);
  /** The branch as typed; until the user types one it follows the session name. */
  const [typedBranch, setTypedBranch] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const openedAt = useRef(new Date());

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    fetchRepoInfo(project).then(
      (info) => {
        if (live) {
          setRepo(info);
        }
      },
      () => {
        if (live) {
          setRepo("error");
        }
      },
    );
    return () => {
      live = false;
    };
  }, [project]);

  const info = typeof repo === "object" ? repo : undefined;
  const worktreeReady = Boolean(info?.repo && info.head);
  const taken = info?.branches ?? [];
  const branch = typedBranch ?? suggestBranch(title, taken, openedAt.current);
  const problem = useWorktree && worktreeReady ? branchProblem(branch, taken) : null;

  function close() {
    if (!creating) {
      onClose();
    }
  }

  function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    if (creating || problem) {
      return;
    }
    setCreating(true);
    setError("");
    const name = normalizeSessionTitle(title);
    void createSession(project, {
      ...(name ? { title: name } : {}),
      ...(useWorktree && worktreeReady ? { worktree: { branch: branch.trim() } } : {}),
    })
      .then(onCreated)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "세션을 만들지 못했습니다");
        setCreating(false);
      });
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <form
        className="modal ns-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-session-title"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
          // Enter that only finishes a Hangul syllable must not make the session.
          if (event.key === "Enter" && isImeKeyboardEvent(event)) {
            event.preventDefault();
          }
        }}
      >
        <header className="ns-head">
          <h2 id="new-session-title">새 세션</h2>
          <p className="ns-project" title={project}>
            <span className="ns-project-name">{folderName(project)}</span>
            <span className="ns-project-path">{homePath(project)}</span>
          </p>
        </header>
        <label>
          이름
          <input
            ref={nameRef}
            className="ns-input"
            value={title}
            maxLength={SESSION_TITLE_MAX}
            placeholder="비워 두면 첫 메시지로 정합니다"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="ns-worktree">
          <label className="team-switch ns-option">
            <span className="ns-option-text">
              <span className="ns-option-title">워크트리에서 시작</span>
              <span className="ns-option-note">
                <WorktreeNote repo={repo} />
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={useWorktree && worktreeReady}
              disabled={!worktreeReady || creating}
              onChange={(event) => setUseWorktree(event.target.checked)}
            />
            <span className="team-switch-track" aria-hidden="true" />
          </label>
          {useWorktree && info && worktreeReady ? (
            <div className="ns-branch">
              <label>
                브랜치
                <input
                  className="ns-input is-mono"
                  value={branch}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  aria-invalid={problem ? true : undefined}
                  onChange={(event) => setTypedBranch(event.target.value)}
                />
              </label>
              {problem ? (
                <p className="ns-problem">{problem}</p>
              ) : info.worktreesDir ? (
                <p className="ns-where" title={worktreePreview(info.worktreesDir, branch)}>
                  {homePath(worktreePreview(info.worktreesDir, branch))}
                </p>
              ) : null}
              {info.changes > 0 ? (
                <p className="ns-changes">
                  <span className="team-dirty" aria-hidden="true" />
                  커밋하지 않은 변경 {info.changes}개는 워크트리에 따라가지 않습니다
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        {error ? <p className="hint danger">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="ghost" disabled={creating} onClick={close}>
            취소
          </button>
          <button type="submit" disabled={creating || Boolean(problem)}>
            {creating ? "만드는 중…" : "만들기"}
          </button>
        </div>
      </form>
    </div>
  );
}

function WorktreeNote({ repo }: { repo: GitRepoInfo | "loading" | "error" }) {
  if (repo === "loading") {
    return <>저장소인지 확인하는 중…</>;
  }
  if (repo === "error") {
    return <>저장소를 확인하지 못했습니다</>;
  }
  if (!repo.repo) {
    return <>git 저장소가 아니어서 쓸 수 없습니다</>;
  }
  if (!repo.head) {
    return <>커밋이 아직 없어 쓸 수 없습니다</>;
  }
  return (
    <>
      <span className="ns-mono">{repo.branch ?? repo.head}</span>에서 새 브랜치를 만들어 다른 폴더에서
      작업합니다
    </>
  );
}
