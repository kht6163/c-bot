import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PROTOCOL_VERSION,
  asSessionId,
  type ProjectView,
  type ServerFrame,
  type SessionEvent,
  type SessionId,
  type SessionSummary,
} from "@cbot/shared";
import { Composer } from "./components/Composer.tsx";
import { NewBotDialog } from "./components/NewBotDialog.tsx";
import { SettingsDialog } from "./components/SettingsDialog.tsx";
import { WorkspacePicker } from "./components/WorkspacePicker.tsx";
import {
  createBot,
  createSession,
  fetchBots,
  fetchHealth,
  fetchProject,
  fetchSession,
  fetchSessions,
  fetchSettings,
  openEvents,
  openProject,
  sendApproval,
  sendMessage,
  type BotView,
} from "./lib/api.ts";
import { visibleRows } from "./lib/rows.ts";

type Tab = "sessions" | "bots";
type LinkState = "connecting" | "ok" | "down";

export function App() {
  const [tab, setTab] = useState<Tab>("sessions");
  const [link, setLink] = useState<LinkState>("connecting");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [bots, setBots] = useState<BotView[]>([]);
  const [selectedId, setSelectedId] = useState<SessionId | undefined>();
  const [selected, setSelected] = useState<SessionSummary | undefined>();
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [newBotOpen, setNewBotOpen] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [project, setProject] = useState<ProjectView | undefined>();
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const selectedRef = useRef<SessionId | undefined>(undefined);
  const logRef = useRef<HTMLDivElement>(null);

  selectedRef.current = selectedId;

  const mergeEvent = useCallback((event: SessionEvent) => {
    setEvents((current) => {
      if (current.some((item) => item.seq === event.seq)) {
        return current;
      }
      return [...current, event].sort((a, b) => a.seq - b.seq);
    });
  }, []);

  const loadList = useCallback(async () => {
    const [nextSessions, nextBots, nextProject] = await Promise.all([
      fetchSessions(),
      fetchBots(),
      fetchProject(),
    ]);
    setSessions(nextSessions);
    setBots(nextBots);
    setProject(nextProject);
  }, []);

  const openSession = useCallback(async (id: SessionId) => {
    setSelectedId(id);
    const detail = await fetchSession(id);
    setSelected(detail.session);
    setEvents(detail.events);
    if (detail.session.kind === "coding") {
      setSessions((current) => {
        const others = current.filter((s) => s.id !== id);
        return [detail.session, ...others];
      });
    }
    socketRef.current?.send(JSON.stringify({ type: "subscribe", sessionId: id }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | undefined;

    void fetchHealth()
      .then((health) => {
        if (!cancelled && health.ok && health.version === PROTOCOL_VERSION) {
          setLink("ok");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLink("down");
        }
      });

    void loadList();
    void fetchSettings()
      .then((settings) => {
        if (!cancelled) {
          setHasApiKey(settings.hasApiKey);
        }
      })
      .catch(() => {
        /* settings are optional at first paint */
      });

    try {
      socket = openEvents();
      socketRef.current = socket;
      socket.addEventListener("message", (ev) => {
        if (cancelled || typeof ev.data !== "string") {
          return;
        }
        let frame: ServerFrame;
        try {
          frame = JSON.parse(ev.data) as ServerFrame;
        } catch {
          return;
        }
        if (frame.type === "hello") {
          setLink("ok");
          const id = selectedRef.current;
          if (id) {
            socket?.send(JSON.stringify({ type: "subscribe", sessionId: id }));
          }
        }
        if (frame.type === "event" && frame.sessionId === selectedRef.current) {
          mergeEvent(frame.event);
        }
      });
      socket.addEventListener("error", () => {
        if (!cancelled) {
          setLink("down");
        }
      });
      socket.addEventListener("close", () => {
        if (!cancelled) {
          setLink((current) => (current === "ok" ? "down" : current));
        }
      });
    } catch {
      setLink("down");
    }

    return () => {
      cancelled = true;
      socket?.close();
      socketRef.current = undefined;
    };
  }, [loadList, mergeEvent]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  const rows = useMemo(() => visibleRows(events), [events]);
  const emptyLabel = tab === "sessions"
    ? (project?.current ? "이 프로젝트에 세션이 없습니다" : "프로젝트를 먼저 여세요")
    : "봇이 없습니다";
  const composerReady = Boolean(
    selectedId && (selected?.kind === "bot-chat" || selected?.workspace),
  );

  async function switchProject(path: string) {
    const next = await openProject(path);
    setProject(next);
    setWorkspaceOpen(false);
    const list = await fetchSessions();
    setSessions(list);
    if (selected?.kind === "coding" && selected.workspace !== next.current) {
      setSelectedId(undefined);
      setSelected(undefined);
      setEvents([]);
    }
  }

  const handleSend = useCallback((text: string) => {
    const id = selectedRef.current;
    if (!id) {
      return;
    }
    void sendMessage(id, text).then(() => loadList());
  }, [loadList]);

  const overlayOpen = settingsOpen || workspaceOpen || newBotOpen;

  return (
    <>
    <div className="app" {...(overlayOpen ? { inert: true, "aria-hidden": true } : {})}>
      <aside className="rail">
        <div className="brand-row">
          <div className="brand">c-bot</div>
          <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)}>
            설정
          </button>
        </div>
        <button
          type="button"
          className="project-btn"
          onClick={() => setWorkspaceOpen(true)}
        >
          {project?.name ?? "프로젝트 열기"}
          {project?.current ? <span className="bot-role">{project.current}</span> : null}
        </button>
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "sessions"}
            className={tab === "sessions" ? "tab active" : "tab"}
            onClick={() => setTab("sessions")}
          >
            세션
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "bots"}
            className={tab === "bots" ? "tab active" : "tab"}
            onClick={() => setTab("bots")}
          >
            봇
          </button>
        </div>
        {tab === "sessions" ? (
          <div className="list">
            <button
              type="button"
              className="new-btn"
              onClick={() => {
                if (!project?.current) {
                  setWorkspaceOpen(true);
                  return;
                }
                void (async () => {
                  const session = await createSession();
                  setSessions((current) => [session, ...current.filter((s) => s.id !== session.id)]);
                  await openSession(session.id);
                })();
              }}
            >
              새 세션
            </button>
            {sessions.length === 0 ? (
              <p className="empty">{emptyLabel}</p>
            ) : (
              <ul>
                {sessions.map((session) => (
                  <li key={session.id}>
                    <button
                      type="button"
                      className={session.id === selectedId ? "session-btn active" : "session-btn"}
                      onClick={() => {
                        void openSession(session.id);
                      }}
                    >
                      {session.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="list">
            <button type="button" className="new-btn" onClick={() => setNewBotOpen(true)}>
              새 봇
            </button>
            {bots.length === 0 ? (
              <p className="empty">{emptyLabel}</p>
            ) : (
              <ul>
                {bots.map((bot) => (
                  <li key={bot.id}>
                    <button
                      type="button"
                      className={bot.sessionId === selectedId ? "session-btn active" : "session-btn"}
                      onClick={() => {
                        void openSession(asSessionId(bot.sessionId));
                      }}
                    >
                      @{bot.handle}
                      <span className="bot-role">{bot.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className={`status status-${link}`}>
          {link === "ok" ? "서버 연결됨" : link === "down" ? "서버 없음" : "연결 중…"}
          {hasApiKey ? " · API 키 있음" : " · API 키 없음"}
        </p>
      </aside>
      <section className="main">
        {selectedId ? (
          <>
            <div className="log" ref={logRef}>
            {rows.length === 0 ? (
              <p className="empty-log">메시지를 보내면 대화가 시작됩니다.</p>
            ) : (
              rows.map((row) =>
                row.kind === "tool" ? (
                  <article key={row.key} className={`tool-card ui-${row.ui}`}>
                    <span className="who">{row.name}</span>
                    <pre>{row.content || row.arguments}</pre>
                    {row.pendingApproval && selectedId ? (
                      <div className="approval">
                        <button
                          type="button"
                          onClick={() => void sendApproval(selectedId, row.callId, true)}
                        >
                          허용
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => void sendApproval(selectedId, row.callId, false)}
                        >
                          거절
                        </button>
                      </div>
                    ) : null}
                  </article>
                ) : (
                  <article
                    key={row.key}
                    className={`bubble ${row.kind}${row.live ? " live" : ""}`}
                  >
                    <span className="who">
                      {row.kind === "user" ? "나" : row.kind === "peer" ? `@${row.handle}` : "c-bot"}
                    </span>
                    <pre>{row.text}</pre>
                  </article>
                ),
              )
            )}
            </div>
          </>
        ) : (
          <div className="hero">
            <h1>c-bot</h1>
            {project?.current ? (
              <p>
                <strong>{project.name}</strong>이 열려 있습니다. 새 세션을 만들면 이 폴더에서
                작업합니다.
              </p>
            ) : (
              <p>프로젝트를 열면 그 폴더에 세션이 묶이고, 파일 도구가 그 안에서만 동작합니다.</p>
            )}
            <p>
              {project?.current ? null : (
                <button type="button" className="ghost" onClick={() => setWorkspaceOpen(true)}>
                  프로젝트 열기
                </button>
              )}
              {hasApiKey ? null : (
                <button type="button" className="ghost" onClick={() => setSettingsOpen(true)}>
                  LLM API 연결
                </button>
              )}
            </p>
          </div>
        )}
        <Composer
          disabled={!composerReady}
          resetKey={selectedId ?? ""}
          placeholder={
            composerReady
              ? "메시지를 입력하세요"
              : !project?.current
                ? "프로젝트를 먼저 여세요"
                : "새 세션을 만들면 메시지를 보낼 수 있습니다"
          }
          onSend={handleSend}
        />
      </section>
    </div>
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={() => {
          void fetchSettings().then((settings) => setHasApiKey(settings.hasApiKey));
        }}
      />
      <NewBotDialog
        open={newBotOpen}
        onClose={() => setNewBotOpen(false)}
        onCreate={async (input) => {
          const bot = await createBot(input);
          setBots((current) => [...current, bot].sort((a, b) => a.handle.localeCompare(b.handle)));
          setNewBotOpen(false);
          await openSession(asSessionId(bot.sessionId));
          setTab("bots");
        }}
      />
      <WorkspacePicker
        open={workspaceOpen}
        current={project?.current ?? null}
        recents={project?.recents ?? []}
        launchDir={project?.launchDir ?? null}
        launchName={project?.launchName ?? null}
        onClose={() => setWorkspaceOpen(false)}
        onSelect={(path) => {
          void switchProject(path);
        }}
      />
    </>
  );
}
