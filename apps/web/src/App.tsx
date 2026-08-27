import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PROTOCOL_VERSION,
  type ServerFrame,
  type SessionEvent,
  type SessionId,
  type SessionSummary,
} from "@cbot/shared";
import { SettingsDialog } from "./components/SettingsDialog.tsx";
import { WorkspacePicker } from "./components/WorkspacePicker.tsx";
import {
  createSession,
  fetchHealth,
  fetchSession,
  fetchSessions,
  openEvents,
  sendApproval,
  sendMessage,
  setWorkspace,
} from "./lib/api.ts";
import { visibleRows } from "./lib/rows.ts";

type Tab = "sessions" | "bots";
type LinkState = "connecting" | "ok" | "down";

export function App() {
  const [tab, setTab] = useState<Tab>("sessions");
  const [link, setLink] = useState<LinkState>("connecting");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<SessionId | undefined>();
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
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
    setSessions(await fetchSessions());
  }, []);

  const openSession = useCallback(
    async (id: SessionId) => {
      setSelectedId(id);
      const detail = await fetchSession(id);
      setEvents(detail.events);
      setSessions((current) => {
        const others = current.filter((s) => s.id !== id);
        return [detail.session, ...others];
      });
      socketRef.current?.send(JSON.stringify({ type: "subscribe", sessionId: id }));
    },
    [],
  );

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
  const emptyLabel = tab === "sessions" ? "세션이 없습니다" : "봇이 없습니다";
  const selected = sessions.find((s) => s.id === selectedId);
  const workspace = selected?.workspace ?? null;
  const composerReady = Boolean(selectedId && workspace);

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand-row">
          <div className="brand">c-bot</div>
          <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)}>
            설정
          </button>
        </div>
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
            <p className="empty">{emptyLabel}</p>
          </div>
        )}
        <p className={`status status-${link}`}>
          {link === "ok" ? "서버 연결됨" : link === "down" ? "서버 없음" : "연결 중…"}
        </p>
      </aside>
      <section className="main">
        {selectedId ? (
          <>
            <div className="workspace-bar">
              <button type="button" className="ghost" onClick={() => setWorkspaceOpen(true)}>
                {workspace ?? "워크스페이스를 선택하세요"}
              </button>
            </div>
            <div className="log" ref={logRef}>
            {rows.length === 0 ? (
              <p className="empty-log">
                {workspace
                  ? "메시지를 보내면 대화가 시작됩니다."
                  : "코딩 턴을 시작하려면 워크스페이스를 고르세요."}
              </p>
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
                    <span className="who">{row.kind === "user" ? "나" : "c-bot"}</span>
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
            <p>세션을 만들고 워크스페이스를 고른 뒤 메시지를 보내세요.</p>
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (!selectedId || !draft.trim()) {
              return;
            }
            const text = draft;
            setDraft("");
            void sendMessage(selectedId, text).then(() => loadList());
          }}
        >
          <textarea
            rows={3}
            disabled={!composerReady}
            value={draft}
            placeholder={
              composerReady
                ? "메시지를 입력하세요"
                : selectedId
                  ? "워크스페이스를 선택하면 메시지를 보낼 수 있습니다"
                  : "새 세션을 만들면 메시지를 보낼 수 있습니다"
            }
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button type="submit" disabled={!composerReady || !draft.trim()}>
            보내기
          </button>
        </form>
      </section>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <WorkspacePicker
        open={workspaceOpen}
        current={workspace}
        onClose={() => setWorkspaceOpen(false)}
        onSelect={(path) => {
          if (!selectedId) {
            return;
          }
          void setWorkspace(selectedId, path).then((session) => {
            setSessions((current) => current.map((s) => (s.id === session.id ? session : s)));
            setWorkspaceOpen(false);
          });
        }}
      />
    </div>
  );
}
