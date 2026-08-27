import { asSessionId, type ProjectView, type SessionId, type SessionSummary } from "@cbot/shared";
import type { BotView } from "../lib/api.ts";
import { folderName, projectPaths, timeAgo } from "../lib/path.ts";

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
  onNewSession: () => void;
  onOpenSession: (id: SessionId) => void;
  onNewBot: () => void;
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
  onNewBot,
}: Props) {
  const projects = project ? projectPaths(project) : [];

  return (
    <aside className="rail">
      <div className="brand-row">
        <div className="brand">c-bot</div>
        <button type="button" className="text-btn" onClick={onOpenSettings}>
          설정
        </button>
      </div>

      <div className="rail-body">
        <section className="rail-section">
          <SectionHead label="프로젝트" addLabel="프로젝트 열기" onAdd={onOpenProjectPicker} />
          {projects.length === 0 ? null : (
            <ul className="row-list">
              {projects.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    className={path === project?.current ? "row active" : "row"}
                    aria-current={path === project?.current ? "true" : undefined}
                    onClick={() => {
                      if (path !== project?.current) {
                        onSelectProject(path);
                      }
                    }}
                  >
                    <span className="row-title">{folderName(path)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rail-section">
          <SectionHead label="세션" addLabel="새 세션" onAdd={onNewSession} />
          {sessions.length === 0 ? (
            <p className="empty">
              {project?.current ? "이 프로젝트에 세션이 없습니다" : "프로젝트를 먼저 여세요"}
            </p>
          ) : (
            <ul className="row-list">
              {sessions.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    className={session.id === selectedId ? "row active" : "row"}
                    aria-current={session.id === selectedId ? "true" : undefined}
                    onClick={() => onOpenSession(session.id)}
                  >
                    <span className="row-title">{session.title}</span>
                    <span className="row-meta">{timeAgo(session.updatedAt)}</span>
                  </button>
                </li>
              ))}
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
                <li key={bot.id}>
                  <button
                    type="button"
                    className={bot.sessionId === selectedId ? "row active" : "row"}
                    aria-current={bot.sessionId === selectedId ? "true" : undefined}
                    onClick={() => onOpenSession(asSessionId(bot.sessionId))}
                  >
                    <span className="row-title">@{bot.handle}</span>
                    <span className="row-meta">{bot.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className={`status status-${link}`}>
        {link === "ok" ? "서버 연결됨" : link === "down" ? "서버 없음" : "연결 중"}
        {hasApiKey ? " · API 키 있음" : " · API 키 없음"}
      </p>
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
