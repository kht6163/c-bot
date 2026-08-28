import { useCallback, useEffect, useRef, useState } from "react";
import {
  PROTOCOL_VERSION,
  type ProjectView,
  type ServerFrame,
  type SessionEvent,
  type SessionId,
  type SessionSummary,
  type SessionTeamMember,
} from "@cbot/shared";
import { Composer } from "./components/Composer.tsx";
import { EditBotDialog } from "./components/EditBotDialog.tsx";
import { NewBotDialog } from "./components/NewBotDialog.tsx";
import { SettingsDialog } from "./components/SettingsDialog.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { TeamStage } from "./components/TeamStage.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { WorkspacePicker } from "./components/WorkspacePicker.tsx";
import {
  createBot,
  createSession,
  deleteBot,
  deleteProject,
  deleteSession,
  fetchBots,
  updateBot,
  fetchHealth,
  fetchProject,
  fetchSession,
  fetchSessions,
  fetchSettings,
  openEvents,
  openProject,
  pickNativeFolder,
  sendApproval,
  sendMessage,
  type BotView,
} from "./lib/api.ts";
import {
  fallbackAfterDelete,
  mergeEventList,
  specialistSessionIds,
  type ViewMode,
} from "./lib/team.ts";
import { reconnectDelay } from "./lib/reconnect.ts";

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
  const [editBotId, setEditBotId] = useState<string | undefined>();
  const [hasApiKey, setHasApiKey] = useState(false);
  const [project, setProject] = useState<ProjectView | undefined>();
  const [pendingSend, setPendingSend] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("agent");
  const [focusedKey, setFocusedKey] = useState("lead");
  const [team, setTeam] = useState<SessionTeamMember[]>([]);
  const [botEvents, setBotEvents] = useState<Record<string, SessionEvent[]>>({});
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTick, setInspectorTick] = useState(0);
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
    const [nextSessions, nextBots, nextProject] = await Promise.all([
      fetchSessions(),
      fetchBots(),
      fetchProject(),
    ]);
    setSessions(nextSessions);
    setBots(nextBots);
    setProject(nextProject);
  }, []);

  const openSession = useCallback(
    async (id: SessionId) => {
      setSelectedId(id);
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
        const workspace = detail.session.workspace;
        if (workspace && workspace !== projectRef.current?.current) {
          const next = await openProject(workspace);
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
    const started = events.some((event) => event.type === "turn/start" && event.seq > after);
    if (started || turnSettledAfter(events, after)) {
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
    setSessions(list);
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

  const overlayOpen = settingsOpen || workspaceOpen || newBotOpen || Boolean(editBotId);
  const editBot = bots.find((item) => item.id === editBotId);

  return (
    <>
    <div
      className={selectedId && inspectorOpen ? "app has-inspector" : "app"}
      {...(overlayOpen ? { inert: true, "aria-hidden": true } : {})}
    >
      <Sidebar
        project={project}
        sessions={sessions}
        bots={bots}
        selectedId={selectedId}
        link={link}
        hasApiKey={hasApiKey}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenProjectPicker={openNativeProject}
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
        onDeleteSession={(session) => {
          void (async () => {
            await deleteSession(session.id);
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
        onDeleteProject={(path) => {
          void (async () => {
            const nextProject = await deleteProject(path);
            setProject(nextProject);
            const remaining = sessions.filter((item) => item.workspace !== path);
            setSessions(remaining);
            if (selected?.workspace === path) {
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
        onNewBot={() => setNewBotOpen(true)}
        onEditBot={(id) => setEditBotId(id)}
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
      <section className="main">
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
            onViewMode={setViewMode}
            onFocus={setFocusedKey}
            onApprove={(sessionId, callId, allow) => {
              void sendApproval(sessionId, callId, allow);
            }}
          />
        ) : (
          <div className="hero">
            <h1>c-bot</h1>
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
        {selectedId && !inspectorOpen ? (
          <button
            type="button"
            className="inspector-open"
            onClick={() => setInspectorOpen(true)}
          >
            패널
          </button>
        ) : null}
        {selectedId ? (
          <Composer
            busy={busy}
            blocked={!composerReady}
            resetKey={selectedId}
            variant="dock"
            placeholder={
              busy ? "생각 중" : focusedKey === "lead" ? "에이전트에게 메시지" : "리드에게 메시지"
            }
            workspace={selected?.workspace ?? project?.current ?? null}
            bots={bots}
            onSend={handleSend}
          />
        ) : null}
      </section>
      {selectedId && inspectorOpen ? (
        <Inspector
          sessionId={selectedId}
          owners={bots.map((bot) => bot.handle)}
          leadHandle={bots.find((bot) => bot.role === "leader")?.handle ?? "leader"}
          refreshKey={inspectorTick}
          onClose={() => setInspectorOpen(false)}
        />
      ) : null}
    </div>
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={() => {
          void fetchSettings().then((next) => {
            setHasApiKey(next.hasApiKey);
          });
        }}
      />
      <NewBotDialog
        open={newBotOpen}
        onClose={() => setNewBotOpen(false)}
        onCreate={async (input) => {
          const bot = await createBot(input);
          const nextBots = [...bots.filter((item) => item.id !== bot.id), bot];
          setBots(nextBots);
          setNewBotOpen(false);
        }}
      />
      <EditBotDialog
        bot={editBot}
        onClose={() => setEditBotId(undefined)}
        onSave={async (input) => {
          if (!editBotId) {
            return;
          }
          const bot = await updateBot(editBotId, input);
          setBots((current) => current.map((item) => (item.id === bot.id ? bot : item)));
          setEditBotId(undefined);
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


