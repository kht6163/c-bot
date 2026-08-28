import { useState } from "react";
import { type ProjectView, type SessionId, type SessionSummary } from "@cbot/shared";
import type { BotView } from "../lib/api.ts";
import { projectTree, timeAgo } from "../lib/path.ts";

type LinkState = "connecting" | "ok" | "down";

interface Props {
  project: ProjectView | undefined;
  sessions: SessionSummary[];
  bots: BotView[];
  selectedId: SessionId | undefined;
  link: LinkState;
  hasApiKey: boolean;
  onOpenSettings: () => void;
  onOpenProjectPicker: () => void;
  onSelectProject: (path: string) => void;
  onNewSession: (path: string) => void;
  onOpenSession: (id: SessionId) => void;
  onDeleteSession: (session: SessionSummary) => void;
  onDeleteProject: (path: string, name: string) => void;
  onNewBot: () => void;
  onEditBot: (id: string) => void;
  onDeleteBot: (id: string) => void;
}

export function Sidebar({
  project,
  sessions,
  bots,
  selectedId,
  link,
  hasApiKey,
  onOpenSettings,
  onOpenProjectPicker,
  onSelectProject,
  onNewSession,
  onOpenSession,
  onDeleteSession,
  onDeleteProject,
  onNewBot,
  onEditBot,
  onDeleteBot,
}: Props) {
  const tree = project ? projectTree(project, sessions) : [];
  const [folded, setFolded] = useState<Record<string, boolean>>({});

  return (
    <aside className="rail">
      <div className="brand-row">
        <div className="brand">c-bot</div>
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
                            if (
                              window.confirm(
                                `"${branch.name}" 프로젝트를 목록에서 지울까요? 이 폴더의 코딩 세션도 삭제됩니다.`,
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
                        {branch.sessions.map((session) => (
                          <li key={session.id} className="session-row">
                            <button
                              type="button"
                              className={session.id === selectedId ? "row active" : "row"}
                              aria-current={session.id === selectedId ? "true" : undefined}
                              onClick={() => onOpenSession(session.id)}
                            >
                              <span className="row-title">{session.title}</span>
                              <span className="row-meta">{timeAgo(session.updatedAt)}</span>
                            </button>
                            <button
                              type="button"
                              className="add-btn row-delete"
                              aria-label={`${session.title} 세션 삭제`}
                              onClick={() => {
                                if (window.confirm(`"${session.title}" 세션을 삭제할까요?`)) {
                                  onDeleteSession(session);
                                }
                              }}
                            >
                              ×
                            </button>
                          </li>
                        ))}
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
                <li key={bot.id} className="bot-row">
                  <button
                    type="button"
                    className="row"
                    onClick={() => onEditBot(bot.id)}
                  >
                    <span className="row-title">@{bot.handle}</span>
                    <span className="row-meta">{bot.role === "leader" ? "Lead" : bot.title}</span>
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
