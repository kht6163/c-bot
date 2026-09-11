import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  SESSION_TITLE_MAX,
  normalizeSessionTitle,
  type ProjectView,
  type SessionId,
  type SessionSummary,
} from "@cbot/shared";
import type { ActivityMap } from "../lib/activity.ts";
import type { BotView } from "../lib/api.ts";
import { isImeKeyboardEvent } from "../lib/ime.ts";
import { projectTree, timeAgo } from "../lib/path.ts";

type LinkState = "connecting" | "ok" | "down";

interface Props {
  project: ProjectView | undefined;
  sessions: SessionSummary[];
  /** Sessions working or finished since the user last looked; keyed by session id. */
  activity: ActivityMap;
  bots: BotView[];
  selectedId: SessionId | undefined;
  link: LinkState;
  hasApiKey: boolean;
  onOpenSettings: () => void;
  onOpenProjectPicker: () => void;
  onSelectProject: (path: string) => void;
  onNewSession: (path: string) => void;
  onOpenSession: (id: SessionId) => void;
  /** Resolves once the new name is saved; a rejection keeps the field open. */
  onRenameSession: (id: SessionId, title: string) => Promise<void>;
  onDeleteSession: (session: SessionSummary) => void;
  onDeleteProject: (path: string, name: string) => void;
  onNewBot: () => void;
  onEditBot: (id: string) => void;
  onDeleteBot: (id: string) => void;
  /** Present while the rail is a drawer over the chat; shows its close button. */
  onClose?: (() => void) | undefined;
}

/** The menu button that opens the drawer points here. */
export const RAIL_ID = "app-rail";

export function Sidebar({
  project,
  sessions,
  activity,
  bots,
  selectedId,
  link,
  hasApiKey,
  onOpenSettings,
  onOpenProjectPicker,
  onSelectProject,
  onNewSession,
  onOpenSession,
  onRenameSession,
  onDeleteSession,
  onDeleteProject,
  onNewBot,
  onEditBot,
  onDeleteBot,
  onClose,
}: Props) {
  const tree = project ? projectTree(project, sessions) : [];
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<SessionId | undefined>();
  const refocusRow = useRef<SessionId | undefined>(undefined);

  useEffect(() => {
    const id = refocusRow.current;
    if (renaming !== undefined || !id) {
      return;
    }
    refocusRow.current = undefined;
    document.querySelector<HTMLButtonElement>(`[data-session-row="${id}"]`)?.focus();
  }, [renaming]);

  return (
    <aside className="rail" id={RAIL_ID}>
      <div className="brand-row">
        <BrandMark />
        <div className="brand">c-bot</div>
        {onClose ? (
          <button type="button" className="bar-btn rail-close" aria-label="메뉴 닫기" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="new-session"
        onClick={() => {
          if (!project?.current) {
            onOpenProjectPicker();
            return;
          }
          onNewSession(project.current);
        }}
      >
        새 세션
      </button>

      <div className="rail-body">
        <section className="rail-section">
          <SectionHead label="프로젝트" addLabel="프로젝트 열기" onAdd={onOpenProjectPicker} />
          {tree.length === 0 ? null : (
            <ul className="row-list">
              {tree.map((branch) => {
                const expanded = folded[branch.path] !== true;
                const current = branch.path === project?.current;
                return (
                  <li key={branch.path} className="tree-branch">
                    <div className="tree-parent">
                      {branch.sessions.length > 0 ? (
                        <button
                          type="button"
                          className="caret"
                          aria-expanded={expanded}
                          aria-label={expanded ? "세션 접기" : "세션 펼치기"}
                          onClick={() => {
                            setFolded((currentFold) => ({
                              ...currentFold,
                              [branch.path]: expanded,
                            }));
                          }}
                        >
                          {expanded ? "▾" : "▸"}
                        </button>
                      ) : (
                        <span className="caret-slot" />
                      )}
                      <button
                        type="button"
                        className={current ? "row current" : "row"}
                        aria-current={current ? "true" : undefined}
                        onClick={() => {
                          setFolded((currentFold) => ({
                            ...currentFold,
                            [branch.path]: false,
                          }));
                          if (!current) {
                            onSelectProject(branch.path);
                          }
                        }}
                      >
                        <span className="row-title">{branch.name}</span>
                      </button>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="add-btn"
                          aria-label="새 세션"
                          onClick={() => onNewSession(branch.path)}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          className="add-btn row-delete"
                          aria-label={`${branch.name} 프로젝트 삭제`}
                          onClick={() => {
                            const worktrees = branch.sessions.filter((session) => session.worktree).length;
                            const also =
                              worktrees > 0
                                ? ` 워크트리 ${worktrees}개도 지웁니다. 브랜치에 커밋한 작업은 남습니다.`
                                : "";
                            if (
                              window.confirm(
                                `"${branch.name}" 프로젝트를 목록에서 지울까요? 이 폴더의 코딩 세션도 삭제됩니다.${also}`,
                              )
                            ) {
                              onDeleteProject(branch.path, branch.name);
                            }
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    {expanded && branch.sessions.length > 0 ? (
                      <ul className="row-list row-nest">
                        {branch.sessions.map((session) =>
                          session.id === renaming ? (
                            <li key={session.id} className="session-row">
                              <RenameField
                                initial={session.title}
                                onSubmit={(title) => onRenameSession(session.id, title)}
                                onDone={(byKey) => {
                                  refocusRow.current = byKey ? session.id : undefined;
                                  setRenaming(undefined);
                                }}
                              />
                            </li>
                          ) : (
                            <li key={session.id} className="session-row">
                              <button
                                type="button"
                                data-session-row={session.id}
                                className={session.id === selectedId ? "row active" : "row"}
                                aria-current={session.id === selectedId ? "true" : undefined}
                                onClick={() => onOpenSession(session.id)}
                                onDoubleClick={() => setRenaming(session.id)}
                                onKeyDown={(event) => {
                                  if (event.key === "F2") {
                                    event.preventDefault();
                                    setRenaming(session.id);
                                  }
                                }}
                              >
                                <span className="row-title">{session.title}</span>
                                {session.worktree ? <BranchMark branch={session.worktree.branch} /> : null}
                                <ActivityDot state={session.id === selectedId ? undefined : activity[session.id]} />
                                <span className="row-meta">{timeAgo(session.updatedAt)}</span>
                              </button>
                              <div className="row-actions session-actions">
                                <button
                                  type="button"
                                  className="add-btn row-edit"
                                  aria-label={`${session.title} 이름 바꾸기`}
                                  title="이름 바꾸기"
                                  onClick={() => setRenaming(session.id)}
                                >
                                  <PencilIcon />
                                </button>
                                <button
                                  type="button"
                                  className="add-btn row-delete"
                                  aria-label={`${session.title} 세션 삭제`}
                                  onClick={() => {
                                    const also = session.worktree
                                      ? ` 워크트리 폴더도 지웁니다. 브랜치 ${session.worktree.branch}에 커밋한 작업은 남습니다.`
                                      : "";
                                    if (window.confirm(`"${session.title}" 세션을 삭제할까요?${also}`)) {
                                      onDeleteSession(session);
                                    }
                                  }}
                                >
                                  ×
                                </button>
                              </div>
                            </li>
                          ),
                        )}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rail-section">
          <SectionHead label="봇" addLabel="새 봇" onAdd={onNewBot} />
          {bots.length === 0 ? (
            <p className="empty">봇이 없습니다</p>
          ) : (
            <ul className="row-list">
              {bots.map((bot) => (
                <li key={bot.id} className={bot.hidden ? "bot-row is-hidden" : "bot-row"}>
                  <button
                    type="button"
                    className="row"
                    title={bot.hidden ? "로스터에서 숨김" : undefined}
                    onClick={() => onEditBot(bot.id)}
                  >
                    <span className="row-title">@{bot.handle}</span>
                    {bot.role === "leader" ? (
                      <span className="row-badge">LEAD</span>
                    ) : (
                      <span className="row-meta">{bot.title}</span>
                    )}
                  </button>
                  {bot.role === "leader" ? (
                    <span className="caret-slot" />
                  ) : (
                    <button
                      type="button"
                      className="add-btn bot-delete"
                      aria-label={`@${bot.handle} 삭제`}
                      onClick={() => {
                        if (window.confirm(`@${bot.handle}을(를) 삭제할까요?`)) {
                          onDeleteBot(bot.id);
                        }
                      }}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="rail-foot">
        <p className={`status status-${link}`}>
          {link === "ok" ? "서버 연결됨" : link === "down" ? "서버 없음" : "연결 중"}
          {hasApiKey ? " · API 키 있음" : " · API 키 없음"}
        </p>
        <button type="button" className="settings-btn" onClick={onOpenSettings}>
          설정
        </button>
      </div>
    </aside>
  );
}

function BrandMark() {
  return (
    <svg className="brand-mark" width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path
        d="M11 2.2 19 6.6v8.8L11 19.8 3 15.4V6.6z"
        stroke="var(--accent)"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="11" cy="11" r="2.5" fill="var(--accent)" />
    </svg>
  );
}

function SectionHead({
  label,
  addLabel,
  onAdd,
}: {
  label: string;
  addLabel: string;
  onAdd: () => void;
}) {
  return (
    <div className="section-head">
      <h2 className="section-label">{label}</h2>
      <button type="button" className="add-btn" onClick={onAdd} aria-label={addLabel}>
        +
      </button>
    </div>
  );
}

/**
 * A session name edited in place. Enter or leaving the field saves, Esc keeps
 * the old name; an unchanged or empty name saves nothing.
 */
function RenameField({
  initial,
  onSubmit,
  onDone,
}: {
  initial: string;
  onSubmit: (title: string) => Promise<void>;
  /** `byKey` when Enter or Esc closed the field, so focus can go back to the row. */
  onDone: (byKey: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  const [failed, setFailed] = useState(false);
  // Busy while saving, closed once done: a blur the unmount fires must not save again.
  const busy = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  function finish(byKey: boolean) {
    busy.current = true;
    onDone(byKey);
  }

  function commit(byKey: boolean) {
    if (busy.current) {
      return;
    }
    const title = normalizeSessionTitle(value);
    if (!title || title === initial) {
      finish(byKey);
      return;
    }
    busy.current = true;
    onSubmit(title).then(
      () => onDone(byKey),
      () => {
        busy.current = false;
        setFailed(true);
      },
    );
  }

  return (
    <input
      ref={input}
      className="row-rename"
      value={value}
      maxLength={SESSION_TITLE_MAX}
      aria-label="세션 이름"
      aria-invalid={failed || undefined}
      title={failed ? "이름을 바꾸지 못했습니다. Esc로 되돌립니다" : undefined}
      onChange={(event) => {
        setValue(event.target.value);
        setFailed(false);
      }}
      onKeyDown={(event) => {
        if (isImeKeyboardEvent(event)) {
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          commit(true);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          finish(true);
        }
      }}
      onBlur={() => {
        if (failed) {
          finish(false);
          return;
        }
        commit(false);
      }}
    />
  );
}

/** Marks a session that works in a worktree of its own. */
function BranchMark({ branch }: { branch: string }) {
  return (
    <span className="row-branch" role="img" aria-label={`워크트리 ${branch}`} title={`워크트리 · ${branch}`}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <circle cx="4" cy="3.2" r="1.5" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="4" cy="10.8" r="1.5" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="10" cy="4.6" r="1.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4 4.7v4.6M10 6.1c0 2.3-2.2 2.6-4.9 3.6" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </span>
  );
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M9.4 2.4 11.6 4.6 5 11.2l-2.8.6.6-2.8z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ActivityDot({ state }: { state: "running" | "done" | undefined }) {
  if (!state) {
    return null;
  }
  return (
    <span
      className={state === "running" ? "row-dot is-running" : "row-dot is-done"}
      role="img"
      aria-label={state === "running" ? "작업 중" : "작업 완료"}
    />
  );
}
