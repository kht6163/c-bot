import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  PROTOCOL_VERSION,
  hasOpenTurn,
  sessionProject,
  type ProjectView,
  type ServerFrame,
  type SessionEvent,
  type SessionId,
  type SessionSummary,
  type SessionTeamMember,
} from "@cbot/shared";
import { Composer } from "./components/Composer.tsx";
import { MobileBar, PanelIcon } from "./components/MobileBar.tsx";
import { NewSessionDialog } from "./components/NewSessionDialog.tsx";
import { SettingsDialog } from "./components/SettingsDialog.tsx";
import { RAIL_ID, Sidebar } from "./components/Sidebar.tsx";
import { TeamPanel } from "./components/TeamPanel.tsx";
import { TeamStage } from "./components/TeamStage.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { loadInspectorWidth, saveInspectorWidth } from "./lib/inspector.ts";
import { DOCK_QUERY, PHONE_QUERY, useMediaQuery } from "./lib/media.ts";
import { folderName } from "./lib/path.ts";
import { NEW_BOT } from "./lib/team-panel.ts";
import { WorkspacePicker } from "./components/WorkspacePicker.tsx";
import {
  createSession,
  deleteBot,
  deleteProject,
  deleteSession,
  fetchBots,
  fetchHealth,
  fetchProject,
  fetchSession,
  fetchSessions,
  fetchSettings,
  interruptSession,
  openEvents,
  openProject,
  pickNativeFolder,
  renameSession,
  sendApproval,
  sendMessage,
  type BotView,
} from "./lib/api.ts";
import {
  fallbackAfterDelete,
  mergeEventList,
  normalizeViewMode,
  specialistSessionIds,
  type ViewMode,
} from "./lib/team.ts";
import { ApiError } from "./lib/api-json.ts";
import { reconnectDelay } from "./lib/reconnect.ts";
import {
  applyActivity,
  clearActivity,
  hiddenActivity,
  seedActivity,
  type ActivityMap,
} from "./lib/activity.ts";
import {
  clearQueue,
  dropQueued,
  enqueue,
  queuedFor,
  type Queues,
} from "./lib/queue.ts";

type LinkState = "connecting" | "ok" | "down";

const ANSWERS_SEND = new Set<SessionEvent["type"]>([
  "turn/start",
  "system/notice",
  "context/compact",
  "context/clear",
]);

export function App() {
  const [link, setLink] = useState<LinkState>("connecting");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activity, setActivity] = useState<ActivityMap>({});
  const [bots, setBots] = useState<BotView[]>([]);
  const [selectedId, setSelectedId] = useState<SessionId | undefined>();
  const [selected, setSelected] = useState<SessionSummary | undefined>();
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  /** The bot the team panel opens on, NEW_BOT to make one, or undefined while it is closed. */
  const [teamTarget, setTeamTarget] = useState<string | undefined>();
  /** The project folder the new-session dialog makes a session in, while it is open. */
  const [newSessionIn, setNewSessionIn] = useState<string | undefined>();
  const [hasApiKey, setHasApiKey] = useState(false);
  const [project, setProject] = useState<ProjectView | undefined>();
  const [pendingSend, setPendingSend] = useState(false);
  const [queues, setQueues] = useState<Queues>({});
  const [viewMode, setViewModeState] = useState<ViewMode>("agent");
  const setViewMode = (mode: ViewMode) => setViewModeState(normalizeViewMode(mode));
  const [focusedKey, setFocusedKey] = useState("lead");
  const [team, setTeam] = useState<SessionTeamMember[]>([]);
  const [botEvents, setBotEvents] = useState<Record<string, SessionEvent[]>>({});
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    loadInspectorWidth(window.localStorage, window.innerWidth),
  );
  const [inspectorTick, setInspectorTick] = useState(0);
  const phone = useMediaQuery(PHONE_QUERY);
  const dock = useMediaQuery(DOCK_QUERY);
  /** The rail as a drawer over the chat; only a phone has one. */
  const [railOpen, setRailOpen] = useState(false);
  /** The inspector as a sheet over the chat, where it cannot dock beside it. */
  const [sheetOpen, setSheetOpen] = useState(false);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const selectedRef = useRef<SessionId | undefined>(undefined);
  const eventsRef = useRef<SessionEvent[]>([]);
  const projectRef = useRef<ProjectView | undefined>(undefined);
  const botsRef = useRef<BotView[]>([]);
  const teamRef = useRef<SessionTeamMember[]>([]);
  const watchIdsRef = useRef<string[]>([]);
  const sendSeqRef = useRef(0);

  selectedRef.current = selectedId;
  eventsRef.current = events;
  projectRef.current = project;
  botsRef.current = bots;
  teamRef.current = team;

  const subscribeWatched = useCallback((ids: string[]) => {
    watchIdsRef.current = ids;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    for (const id of ids) {
      socket.send(JSON.stringify({ type: "subscribe", sessionId: id }));
    }
  }, []);

  const loadSpecialistLogs = useCallback(async (members: SessionTeamMember[]) => {
    const ids = specialistSessionIds(members);
    const entries = await Promise.all(
      ids.map(async (id) => {
        try {
          const detail = await fetchSession(id);
          return [id, detail.events] as const;
        } catch {
          return [id, [] as SessionEvent[]] as const;
        }
      }),
    );
    const next: Record<string, SessionEvent[]> = {};
    for (const [id, nextEvents] of entries) {
      next[id] = nextEvents;
    }
    setBotEvents(next);
    return ids;
  }, []);

  const refreshTeam = useCallback(
    async (id: SessionId) => {
      const detail = await fetchSession(id);
      if (selectedRef.current !== id) {
        return;
      }
      setTeam(detail.team);
      const specialistIds = await loadSpecialistLogs(detail.team);
      subscribeWatched([id, ...specialistIds]);
    },
    [loadSpecialistLogs, subscribeWatched],
  );
  const refreshTeamRef = useRef(refreshTeam);
  refreshTeamRef.current = refreshTeam;

  const loadList = useCallback(async () => {
    const [list, nextBots, nextProject] = await Promise.all([
      fetchSessions(),
      fetchBots(),
      fetchProject(),
    ]);
    setSessions(list.sessions);
    setActivity((current) => seedActivity(current, list.running));
    setBots(nextBots);
    setProject(nextProject);
  }, []);

  const openSession = useCallback(
    async (id: SessionId) => {
      setSelectedId(id);
      setActivity((current) => clearActivity(current, id));
      setPendingSend(false);
      setFocusedKey("lead");
      const detail = await fetchSession(id);
      setSelected(detail.session);
      setEvents(detail.events);
      setTeam(detail.team);
      if (detail.session.kind === "coding") {
        setSessions((current) => {
          const others = current.filter((s) => s.id !== id);
          return [detail.session, ...others];
        });
        const home = sessionProject(detail.session);
        if (home && home !== projectRef.current?.current) {
          const next = await openProject(home);
          setProject(next);
        }
      }
      const specialistIds = await loadSpecialistLogs(detail.team);
      subscribeWatched([id, ...specialistIds]);
    },
    [loadSpecialistLogs, subscribeWatched],
  );

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let armed = false;

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

    void loadList().catch(() => {
      armed = true;
    });
    void fetchSettings()
      .then((next) => {
        if (!cancelled) {
          setHasApiKey(next.hasApiKey);
        }
      })
      .catch(() => {
        /* settings are optional at first paint */
      });

    const resync = () => {
      void loadList().catch(() => {
        /* the log on the server is the truth; the next reconnect retries */
      });
      const id = selectedRef.current;
      if (!id) {
        return;
      }
      void (async () => {
        const detail = await fetchSession(id);
        if (cancelled || selectedRef.current !== id) {
          return;
        }
        setSelected(detail.session);
        setEvents(detail.events);
        setTeam(detail.team);
        const specialistIds = await loadSpecialistLogs(detail.team);
        subscribeWatched([id, ...specialistIds]);
      })().catch(() => {
        /* same: the next reconnect retries */
      });
    };

    const schedule = () => {
      if (cancelled || timer !== undefined) {
        return;
      }
      attempt += 1;
      timer = setTimeout(() => {
        timer = undefined;
        connect();
      }, reconnectDelay(attempt));
    };

    function connect(): void {
      if (cancelled) {
        return;
      }
      let ws: WebSocket;
      try {
        ws = openEvents();
      } catch {
        armed = true;
        setLink("down");
        schedule();
        return;
      }
      socket = ws;
      socketRef.current = ws;
      ws.addEventListener("message", (ev) => {
        if (cancelled || socketRef.current !== ws || typeof ev.data !== "string") {
          return;
        }
        let frame: ServerFrame;
        try {
          frame = JSON.parse(ev.data) as ServerFrame;
        } catch {
          return;
        }
        if (frame.type === "hello") {
          attempt = 0;
          setLink("ok");
          const watched = watchIdsRef.current;
          if (watched.length > 0) {
            for (const id of watched) {
              ws.send(JSON.stringify({ type: "subscribe", sessionId: id }));
            }
          } else if (selectedRef.current) {
            ws.send(JSON.stringify({ type: "subscribe", sessionId: selectedRef.current }));
          }
          if (armed) {
            armed = false;
            resync();
          }
        }
        if (frame.type === "session/activity") {
          setActivity((current) =>
            applyActivity(current, frame.sessionId, frame.running, selectedRef.current),
          );
        }
        if (frame.type === "event") {
          if (frame.sessionId === selectedRef.current) {
            setEvents((current) => mergeEventList(current, frame.event));
            if (isTeamSignal(frame.event)) {
              void refreshTeamRef.current(frame.sessionId);
            }
            if (
              frame.event.type === "task/change" ||
              frame.event.type === "tool/result" ||
              frame.event.type === "turn/end"
            ) {
              setInspectorTick((n) => n + 1);
            }
          } else {
            if (
              teamRef.current.some((member) => member.sessionId === frame.sessionId) &&
              (frame.event.type === "tool/result" || frame.event.type === "turn/end")
            ) {
              setInspectorTick((n) => n + 1);
            }
            setBotEvents((current) => {
              const known =
                frame.sessionId in current ||
                teamRef.current.some((member) => member.sessionId === frame.sessionId);
              if (!known) {
                return current;
              }
              return {
                ...current,
                [frame.sessionId]: mergeEventList(current[frame.sessionId] ?? [], frame.event),
              };
            });
          }
        }
      });
      ws.addEventListener("error", () => {
        if (!cancelled) {
          setLink("down");
        }
      });
      ws.addEventListener("close", () => {
        if (cancelled || socketRef.current !== ws) {
          return;
        }
        socketRef.current = undefined;
        armed = true;
        setLink("down");
        schedule();
      });
    }

    connect();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      socket?.close();
      socketRef.current = undefined;
    };
  }, [loadList, loadSpecialistLogs, subscribeWatched]);

  useEffect(() => {
    if (!pendingSend) {
      return;
    }
    const after = sendSeqRef.current;
    // A turn that was already open when we sent does not clear the wait: ours
    // has not started. A slash command answers with a notice or a context
    // boundary instead of a turn, and that ends the wait just as well.
    if (events.some((event) => event.seq > after && ANSWERS_SEND.has(event.type))) {
      setPendingSend(false);
    }
  }, [events, pendingSend]);

  const busy = pendingSend || hasOpenTurn(events);
  const composerReady = Boolean(selectedId && selected?.kind === "coding" && selected.workspace);

  async function switchProject(path: string) {
    const next = await openProject(path);
    setProject(next);
    setWorkspaceOpen(false);
    const list = await fetchSessions();
    setSessions(list.sessions);
    setActivity((current) => seedActivity(current, list.running));
  }

  function openNativeProject() {
    void pickNativeFolder()
      .then(async (picked) => {
        if ("cancelled" in picked) {
          return;
        }
        await switchProject(picked.path);
      })
      .catch(() => {
        setWorkspaceOpen(true);
      });
  }

  const handleSend = useCallback(
    (text: string) => {
      void (async () => {
        let id = selectedRef.current;
        if (id && selected?.kind === "bot-chat") {
          return;
        }
        if (!id) {
          const workspace = projectRef.current?.current;
          if (!workspace) {
            openNativeProject();
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
    [loadList, openSession, selected],
  );

  const queued = queuedFor(queues, selectedId);

  const handleQueue = useCallback((text: string) => {
    const id = selectedRef.current;
    if (!id) {
      return;
    }
    setQueues((current) => enqueue(current, id, { id: newQueueId(), text }));
  }, []);

  const handleDropQueued = useCallback((itemId: string) => {
    const id = selectedRef.current;
    if (!id) {
      return;
    }
    setQueues((current) => dropQueued(current, id, itemId));
  }, []);

  const handleInterrupt = useCallback(
    (text: string | null) => {
      const id = selectedRef.current;
      if (!id) {
        return;
      }
      void (async () => {
        try {
          await interruptSession(id);
        } catch {
          /* the turn may have ended on its own; the queue still drains */
        }
        if (text) {
          handleSend(text);
        }
      })();
    },
    [handleSend],
  );

  // The queue is a draft list: one message leaves it only once the session is idle again.
  useEffect(() => {
    if (busy || !selectedId) {
      return;
    }
    const next = queuedFor(queues, selectedId)[0];
    if (!next) {
      return;
    }
    setQueues((current) => dropQueued(current, selectedId, next.id));
    handleSend(next.text);
  }, [busy, selectedId, queues, handleSend]);

  const overlayOpen =
    settingsOpen || workspaceOpen || teamTarget !== undefined || newSessionIn !== undefined;
  const drawer = phone && railOpen;
  const sheet = !dock && sheetOpen && selectedId !== undefined;
  const docked = dock && inspectorOpen && selectedId !== undefined;
  const layer = sheet ? "sheet" : drawer ? "drawer" : null;

  // Left open across a breakpoint, a drawer or sheet would pop up unasked the
  // next time the window narrows.
  useEffect(() => setRailOpen(false), [phone]);
  useEffect(() => setSheetOpen(false), [dock]);

  useEffect(() => {
    if (!layer) {
      return;
    }
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root =
      layer === "drawer"
        ? document.getElementById(RAIL_ID)
        : document.querySelector<HTMLElement>(".inspector.is-sheet");
    root
      ?.querySelector<HTMLElement>(layer === "drawer" ? "button" : '[role="tab"][aria-selected="true"]')
      ?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      if (layer === "sheet") {
        setSheetOpen(false);
      } else {
        setRailOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Back to the button that opened the layer, unless focus has already moved on.
      const active = document.activeElement;
      if (!active || active === document.body || root?.contains(active)) {
        opener?.focus();
      }
    };
  }, [layer]);

  function openPanel() {
    if (dock) {
      setInspectorOpen(true);
    } else {
      setSheetOpen(true);
    }
  }

  const selectedSummary = selected ?? sessions.find((item) => item.id === selectedId);
  const selectedHome = selectedSummary ? sessionProject(selectedSummary) : null;

  return (
    <>
    <div
      className={["app", docked ? "has-inspector" : "", drawer ? "rail-open" : ""].filter(Boolean).join(" ")}
      // The width is a custom property so the narrow-window media query can still win.
      style={{ "--inspector-w": `${inspectorWidth}px` } as CSSProperties}
      // The sheet keeps the chat in sight under its scrim, so it only makes it inert.
      {...(overlayOpen ? { inert: true, "aria-hidden": true } : sheet ? { inert: true } : {})}
    >
      {phone ? <div className="rail-scrim" aria-hidden="true" onClick={() => setRailOpen(false)} /> : null}
      <Sidebar
        project={project}
        sessions={sessions}
        activity={activity}
        bots={bots}
        selectedId={selectedId}
        link={link}
        hasApiKey={hasApiKey}
        onClose={phone ? () => setRailOpen(false) : undefined}
        onOpenSettings={() => {
          setRailOpen(false);
          setSettingsOpen(true);
        }}
        onOpenProjectPicker={openNativeProject}
        onSelectProject={(path) => {
          void switchProject(path);
        }}
        onNewSession={(path) => {
          setRailOpen(false);
          setNewSessionIn(path);
        }}
        onOpenSession={(id) => {
          setRailOpen(false);
          void openSession(id);
        }}
        onRenameSession={async (id, title) => {
          const renamed = await renameSession(id, title);
          setSessions((current) => current.map((item) => (item.id === id ? renamed : item)));
          if (selectedRef.current === id) {
            setSelected(renamed);
          }
        }}
        onDeleteSession={(session) => {
          void (async () => {
            const deleted = await confirmingDirtyWorktree(
              (force) => deleteSession(session.id, { force }).then(() => true),
              `"${session.title}"의 워크트리에 커밋하지 않은 변경이 있습니다. 버리고 지울까요?`,
            );
            if (!deleted) {
              return;
            }
            setQueues((current) => clearQueue(current, session.id));
            const remaining = sessions.filter((item) => item.id !== session.id);
            setSessions(remaining);
            const next = fallbackAfterDelete(session, selectedId, remaining);
            if (next) {
              if (next.id !== selectedId) {
                await openSession(next.id);
              }
              return;
            }
            setSelectedId(undefined);
            setSelected(undefined);
            setEvents([]);
            setTeam([]);
            setBotEvents({});
            subscribeWatched([]);
          })();
        }}
        onDeleteProject={(path, name) => {
          void (async () => {
            const nextProject = await confirmingDirtyWorktree(
              (force) => deleteProject(path, { force }),
              `"${name}"의 워크트리에 커밋하지 않은 변경이 있습니다. 버리고 지울까요?`,
            );
            if (!nextProject) {
              return;
            }
            setProject(nextProject);
            const remaining = sessions.filter((item) => sessionProject(item) !== path);
            setQueues((current) =>
              sessions
                .filter((item) => sessionProject(item) === path)
                .reduce((acc, item) => clearQueue(acc, item.id), current),
            );
            setSessions(remaining);
            if (selected && sessionProject(selected) === path) {
              const next = remaining[0];
              if (next) {
                await openSession(next.id);
              } else {
                setSelectedId(undefined);
                setSelected(undefined);
                setEvents([]);
                setTeam([]);
                setBotEvents({});
                subscribeWatched([]);
              }
            }
          })();
        }}
        onNewBot={() => {
          setRailOpen(false);
          setTeamTarget(NEW_BOT);
        }}
        onEditBot={(id) => {
          setRailOpen(false);
          setTeamTarget(id);
        }}
        onDeleteBot={(id) => {
          void (async () => {
            const bot = bots.find((item) => item.id === id);
            await deleteBot(id);
            const nextBots = bots.filter((item) => item.id !== id);
            setBots(nextBots);
            const nextTeam = team.filter((member) => member.id !== id);
            setTeam(nextTeam);
            if (bot) {
              setBotEvents((current) => {
                const next = { ...current };
                for (const member of team) {
                  if (member.id === id) {
                    delete next[member.sessionId];
                  }
                }
                return next;
              });
              if (focusedKey === bot.id) {
                setFocusedKey("lead");
              }
            }
            if (selectedRef.current) {
              subscribeWatched([selectedRef.current, ...specialistSessionIds(nextTeam)]);
            }
          })();
        }}
      />
      <section className="main" inert={drawer}>
        {phone ? (
          <MobileBar
            title={selectedSummary?.title}
            project={selectedHome ? folderName(selectedHome) : undefined}
            activity={hiddenActivity(
              activity,
              sessions.map((item) => item.id),
              selectedId,
            )}
            menuOpen={drawer}
            onMenu={() => setRailOpen(true)}
            onPanel={selectedId ? openPanel : undefined}
          />
        ) : null}
        {selectedId ? (
          <TeamStage
            codingSessionId={selectedId}
            bots={team}
            leadHandle={bots.find((bot) => bot.role === "leader")?.handle ?? "leader"}
            leadTitle={bots.find((bot) => bot.role === "leader")?.title ?? "Lead"}
            codingEvents={events}
            botEvents={botEvents}
            viewMode={viewMode}
            focusedKey={focusedKey}
            codingBusy={busy}
            boardTick={inspectorTick}
            onViewMode={setViewMode}
            onFocus={setFocusedKey}
            onApprove={(sessionId, callId, allow, remember) => {
              void sendApproval(sessionId, callId, allow, remember);
            }}
            barEnd={
              // A phone opens the panel from its top bar; a docked panel that is open needs no button.
              phone || docked ? null : (
                <button type="button" className="view-toggle" onClick={openPanel}>
                  <PanelIcon size={13} />
                  패널
                </button>
              )
            }
          />
        ) : (
          <div className="hero">
            <svg className="hero-mark" width="52" height="52" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <path
                d="M11 2.2 19 6.6v8.8L11 19.8 3 15.4V6.6z"
                stroke="var(--accent)"
                strokeWidth="1"
                strokeLinejoin="round"
              />
              <circle cx="11" cy="11" r="2.5" fill="var(--accent)" />
            </svg>
            <h1>c-bot</h1>
            <p className="hero-sub">웹 브라우저에서 쓰는 코딩 에이전트</p>
            {project?.current ? (
              <p className="hero-chip">
                <button type="button" className="ghost" onClick={openNativeProject}>
                  {project.name}
                </button>
              </p>
            ) : (
              <p className="hero-chip">
                <button type="button" className="ghost" onClick={openNativeProject}>
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
              workspace={project?.current ?? null}
              bots={bots}
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
            placeholder={
              busy ? "다음 메시지를 미리 적어 두세요" : focusedKey === "lead" ? "에이전트에게 메시지" : "리드에게 메시지"
            }
            workspace={selected?.workspace ?? project?.current ?? null}
            bots={bots}
            queued={queued}
            onSend={handleSend}
            onQueue={handleQueue}
            onDrop={handleDropQueued}
            onInterrupt={handleInterrupt}
          />
        ) : null}
      </section>
      {docked ? (
        <Inspector
          sessionId={selectedId}
          refreshKey={inspectorTick}
          width={inspectorWidth}
          onWidth={(px) => {
            setInspectorWidth(px);
            saveInspectorWidth(px, window.localStorage);
          }}
          onClose={() => setInspectorOpen(false)}
        />
      ) : null}
    </div>
      {sheet ? (
        <>
          <div className="sheet-scrim" aria-hidden="true" onClick={() => setSheetOpen(false)} />
          <Inspector
            sheet
            sessionId={selectedId}
            refreshKey={inspectorTick}
            width={inspectorWidth}
            onWidth={setInspectorWidth}
            onClose={() => setSheetOpen(false)}
          />
        </>
      ) : null}
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={() => {
          void fetchSettings().then((next) => {
            setHasApiKey(next.hasApiKey);
          });
        }}
      />
      {newSessionIn !== undefined ? (
        <NewSessionDialog
          project={newSessionIn}
          onClose={() => setNewSessionIn(undefined)}
          onCreated={(session) => {
            setNewSessionIn(undefined);
            setSessions((current) => [session, ...current.filter((s) => s.id !== session.id)]);
            void (async () => {
              setProject(await fetchProject());
              await openSession(session.id);
            })();
          }}
        />
      ) : null}
      {teamTarget !== undefined ? (
        <TeamPanel
          target={teamTarget}
          bots={bots}
          onClose={() => setTeamTarget(undefined)}
          onSaved={(bot) => setBots((current) => current.map((item) => (item.id === bot.id ? bot : item)))}
          onCreated={(bot) => setBots((current) => [...current.filter((item) => item.id !== bot.id), bot])}
        />
      ) : null}
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

function newQueueId(): string {
  return crypto.randomUUID();
}

/**
 * Runs a delete once; when a worktree it would remove still holds work, asks
 * and runs it again with force. Undefined when the user kept the work.
 */
async function confirmingDirtyWorktree<T>(
  run: (force: boolean) => Promise<T>,
  question: string,
): Promise<T | undefined> {
  try {
    return await run(false);
  } catch (err) {
    if (!(err instanceof ApiError) || err.reason !== "worktree_dirty") {
      throw err;
    }
  }
  if (!window.confirm(question)) {
    return undefined;
  }
  return run(true);
}

function isTeamSignal(event: SessionEvent): boolean {
  return (
    event.type === "bot/delivery" ||
    (event.type === "tool/call" && event.call.name === "message_agent")
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




