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
import { Sidebar } from "./components/Sidebar.tsx";
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
import { visibleRows, type ChatRow } from "./lib/rows.ts";

type LinkState = "connecting" | "ok" | "down";

export function App() {
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
  const [pendingSend, setPendingSend] = useState(false);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const selectedRef = useRef<SessionId | undefined>(undefined);
  const eventsRef = useRef<SessionEvent[]>([]);
  const projectRef = useRef<ProjectView | undefined>(undefined);
  const sendSeqRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  selectedRef.current = selectedId;
  eventsRef.current = events;
  projectRef.current = project;

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
    setPendingSend(false);
    const detail = await fetchSession(id);
    setSelected(detail.session);
    setEvents(detail.events);
    if (detail.session.kind === "coding") {
      setSessions((current) => {
        const others = current.filter((s) => s.id !== id);
        return [detail.session, ...others];
      });
      const workspace = detail.session.workspace;
      if (workspace && workspace !== projectRef.current?.current) {
        const next = await openProject(workspace);
        setProject(next);
      }
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

  useEffect(() => {
    if (!pendingSend) {
      return;
    }
    const after = sendSeqRef.current;
    const started = events.some((event) => event.type === "turn/start" && event.seq > after);
    if (started || turnSettledAfter(events, after)) {
      setPendingSend(false);
    }
  }, [events, pendingSend]);

  const rows = useMemo(() => visibleRows(events), [events]);
  const busy = pendingSend || hasOpenTurn(events);
  const log = useMemo(() => withThinking(rows, busy), [rows, busy]);
  const composerReady = Boolean(
    selectedId && (selected?.kind === "bot-chat" || selected?.workspace),
  );

  async function switchProject(path: string) {
    const next = await openProject(path);
    setProject(next);
    setWorkspaceOpen(false);
    const list = await fetchSessions();
    setSessions(list);
  }

  const handleSend = useCallback(
    (text: string) => {
      void (async () => {
        let id = selectedRef.current;
        if (!id) {
          const workspace = projectRef.current?.current;
          if (!workspace) {
            setWorkspaceOpen(true);
            return;
          }
          const session = await createSession(workspace);
          setSessions((current) => [session, ...current.filter((s) => s.id !== session.id)]);
          await openSession(session.id);
          id = session.id;
        }
        sendSeqRef.current = maxSeq(eventsRef.current);
        setPendingSend(true);
        try {
          await sendMessage(id, text);
          await loadList();
        } catch {
          setPendingSend(false);
        }
      })();
    },
    [loadList, openSession],
  );

  const overlayOpen = settingsOpen || workspaceOpen || newBotOpen;

  return (
    <>
    <div className="app" {...(overlayOpen ? { inert: true, "aria-hidden": true } : {})}>
      <Sidebar
        project={project}
        sessions={sessions}
        bots={bots}
        selectedId={selectedId}
        link={link}
        hasApiKey={hasApiKey}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenProjectPicker={() => setWorkspaceOpen(true)}
        onSelectProject={(path) => {
          void switchProject(path);
        }}
        onNewSession={(path) => {
          void (async () => {
            const session = await createSession(path);
            setSessions((current) => [session, ...current.filter((s) => s.id !== session.id)]);
            setProject(await fetchProject());
            await openSession(session.id);
          })();
        }}
        onOpenSession={(id) => {
          void openSession(id);
        }}
        onNewBot={() => setNewBotOpen(true)}
      />
      <section className="main">
        {selectedId ? (
          <div className="log" ref={logRef}>
            {log.length === 0 ? (
              <p className="empty-log">메시지를 보내면 대화가 시작됩니다.</p>
            ) : (
              log.map((row) =>
                row.kind === "status" ? (
                  <div key={row.key} className="scaffold" role="status" aria-live="polite">
                    <span className="scaffold-pulse" aria-hidden="true" />
                    {row.text}
                  </div>
                ) : row.kind === "tool" ? (
                  <article
                    key={row.key}
                    className={`tool-card ui-${row.ui}${row.live ? " live" : ""}`}
                  >
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
                    {row.kind === "peer" ? <span className="who">@{row.handle}</span> : null}
                    <pre>{row.text}</pre>
                  </article>
                ),
              )
            )}
          </div>
        ) : (
          <div className="hero">
            <h1>c-bot</h1>
            {project?.current ? (
              <p className="hero-chip">
                <button type="button" className="ghost" onClick={() => setWorkspaceOpen(true)}>
                  {project.name}
                </button>
              </p>
            ) : (
              <p className="hero-chip">
                <button type="button" className="ghost" onClick={() => setWorkspaceOpen(true)}>
                  프로젝트 열기
                </button>
                {hasApiKey ? null : (
                  <button type="button" className="ghost" onClick={() => setSettingsOpen(true)}>
                    LLM 연결
                  </button>
                )}
              </p>
            )}
            <Composer
              busy={busy}
              blocked={!project?.current}
              resetKey={selectedId ?? "home"}
              variant="hero"
              placeholder="무엇을 만들지 적어 보세요"
              onSend={handleSend}
            />
          </div>
        )}
        {selectedId ? (
          <Composer
            busy={busy}
            blocked={!composerReady}
            resetKey={selectedId}
            variant="dock"
            placeholder={busy ? "생각 중" : "에이전트에게 메시지"}
            onSend={handleSend}
          />
        ) : null}
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

function maxSeq(events: readonly SessionEvent[]): number {
  let max = 0;
  for (const event of events) {
    if (event.seq > max) {
      max = event.seq;
    }
  }
  return max;
}

function hasOpenTurn(events: readonly SessionEvent[]): boolean {
  const open = new Set<string>();
  for (const event of events) {
    if (event.type === "turn/start") {
      open.add(event.turnId);
    }
    if (event.type === "turn/end") {
      open.delete(event.turnId);
    }
  }
  return open.size > 0;
}

function turnSettledAfter(events: readonly SessionEvent[], afterSeq: number): boolean {
  const open = new Set<string>();
  let saw = false;
  for (const event of events) {
    if (event.seq <= afterSeq) {
      continue;
    }
    if (event.type === "turn/start") {
      saw = true;
      open.add(event.turnId);
    }
    if (event.type === "turn/end") {
      saw = true;
      open.delete(event.turnId);
    }
  }
  return saw && open.size === 0;
}

function isLiveWork(row: ChatRow): boolean {
  if (row.kind === "status") {
    return true;
  }
  if (row.kind === "assistant") {
    return row.live;
  }
  if (row.kind === "tool") {
    return row.live || row.pendingApproval;
  }
  return false;
}

function withThinking(rows: ChatRow[], busy: boolean): ChatRow[] {
  if (!busy || rows.some(isLiveWork)) {
    return rows;
  }
  return [...rows, { key: "thinking", kind: "status", text: "생각 중", live: true }];
}
