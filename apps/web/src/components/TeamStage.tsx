import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { ApprovalRemember, SessionEvent, SessionId, ToolCallId } from "@cbot/shared";
import { visibleRows, type ChatRow } from "../lib/rows.ts";
import {
  loadNoteLayout,
  mergeNotes,
  mergeOrder,
  moveNote,
  noteExtent,
  raiseNote,
  resizeNote,
  saveNoteLayout,
  teamPanes,
  toggleCollapsed,
  visibleNote,
  wheelResize,
  type NoteRect,
  type TeamPane,
  type ViewMode,
} from "../lib/team.ts";
import { SessionLog } from "./SessionLog.tsx";
import { TeamGraph } from "./TeamGraph.tsx";

interface BotInfo {
  id: string;
  handle: string;
  title: string;
  role: "leader" | "specialist";
  sessionId: string;
}

interface Props {
  codingSessionId: SessionId;
  bots: BotInfo[];
  leadHandle?: string;
  leadTitle?: string;
  codingEvents: SessionEvent[];
  botEvents: Record<string, SessionEvent[]>;
  viewMode: ViewMode;
  focusedKey: string;
  codingBusy: boolean;
  /** Bumps when the task board may have changed, so the graph re-reads it. */
  boardTick: number;
  onViewMode: (mode: ViewMode) => void;
  onFocus: (key: string) => void;
  onApprove: (sessionId: SessionId, callId: ToolCallId, allow: boolean, remember?: ApprovalRemember) => void;
  /** Trailing slot of the stage bar, so a session control shares the row instead of covering it. */
  barEnd?: ReactNode;
}

export function TeamStage({
  codingSessionId,
  bots,
  leadHandle = "leader",
  leadTitle = "Lead",
  codingEvents,
  botEvents,
  viewMode,
  focusedKey,
  codingBusy,
  boardTick,
  onViewMode,
  onFocus,
  onApprove,
  barEnd,
}: Props) {
  const panes = useMemo(
    () => teamPanes(codingSessionId, bots, leadHandle, leadTitle),
    [bots, codingSessionId, leadHandle, leadTitle],
  );
  const canSplit = panes.length > 1;
  const mode: ViewMode = canSplit ? viewMode : "agent";
  const focused = panes.find((pane) => pane.key === focusedKey) ?? panes[0];

  return (
    <div className="team-stage">
      {canSplit || barEnd ? (
        <div className="stage-bar">
          {!canSplit ? (
            <div className="stage-fill" />
          ) : mode !== "agent" ? (
            <p className="stage-split-label">
              {mode === "split" ? "분할" : "그래프"} · {panes.length} 봇
            </p>
          ) : (
            <div className="agent-tabs" role="tablist" aria-label="봇 세션">
              {panes.map((pane) => (
                <button
                  key={pane.key}
                  type="button"
                  role="tab"
                  aria-selected={pane.key === focused?.key}
                  className={pane.key === focused?.key ? "agent-tab active" : "agent-tab"}
                  onClick={() => onFocus(pane.key)}
                >
                  <span className={`agent-dot${paneBusy(pane, codingEvents, botEvents) ? " live" : ""}`} />
                  @{pane.handle}
                  {pane.role === "lead" ? <span className="agent-lead">Lead</span> : null}
                </button>
              ))}
            </div>
          )}
          {canSplit ? (
            <div className="view-modes" role="group" aria-label="보기">
              {VIEW_MODES.map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  className={mode === item.mode ? "view-mode is-on" : "view-mode"}
                  aria-pressed={mode === item.mode}
                  onClick={() => onViewMode(item.mode)}
                >
                  <ModeIcon mode={item.mode} />
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
          {barEnd}
        </div>
      ) : null}
      {mode === "graph" ? (
        <TeamGraph
          key={codingSessionId}
          sessionId={codingSessionId}
          panes={panes}
          codingEvents={codingEvents}
          botEvents={botEvents}
          codingBusy={codingBusy}
          boardTick={boardTick}
          renderPane={(pane) => (
            <PaneLog
              pane={pane}
              codingEvents={codingEvents}
              botEvents={botEvents}
              codingBusy={codingBusy}
              compact
              onApprove={onApprove}
            />
          )}
        />
      ) : mode === "split" ? (
        <NoteBoard
          sessionId={codingSessionId}
          panes={panes}
          codingEvents={codingEvents}
          botEvents={botEvents}
          codingBusy={codingBusy}
          onApprove={onApprove}
        />
      ) : focused ? (
        <PaneLog
          pane={focused}
          codingEvents={codingEvents}
          botEvents={botEvents}
          codingBusy={codingBusy}
          compact={false}
          onApprove={onApprove}
        />
      ) : null}
      {mode === "agent" && focused?.role === "specialist" ? (
        <p className="stage-hint">보기 전용 · 메시지는 리드에게 보냅니다</p>
      ) : null}
    </div>
  );
}

function Chevron({ down }: { down: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d={down ? "M3 4.5 6 7.5 9 4.5" : "M3 7.5 6 4.5 9 7.5"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: "agent", label: "한 화면" },
  { mode: "split", label: "분할" },
  { mode: "graph", label: "그래프" },
];

/** One frame, two frames, or a node over two: the shape of each view. */
function ModeIcon({ mode }: { mode: ViewMode }) {
  return (
    <svg className="bar-icon" width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      {mode === "graph" ? (
        <>
          <circle cx="7" cy="3" r="1.7" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="3" cy="11" r="1.7" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="11" cy="11" r="1.7" stroke="currentColor" strokeWidth="1.3" />
          <path d="M6 4.4 3.9 9.4M8 4.4l2.1 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </>
      ) : (
        <>
          <rect x="1.6" y="2.6" width="10.8" height="8.8" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
          {mode === "split" ? <path d="M7 2.6v8.8" stroke="currentColor" strokeWidth="1.3" /> : null}
        </>
      )}
    </svg>
  );
}

function NoteBoard({
  sessionId,
  panes,
  codingEvents,
  botEvents,
  codingBusy,
  onApprove,
}: {
  sessionId: SessionId;
  panes: TeamPane[];
  codingEvents: SessionEvent[];
  botEvents: Record<string, SessionEvent[]>;
  codingBusy: boolean;
  onApprove: (sessionId: SessionId, callId: ToolCallId, allow: boolean, remember?: ApprovalRemember) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<Record<string, NoteRect>>({});
  const skipSave = useRef(true);
  const drag = useRef<
    | { kind: "move"; key: string; x: number; y: number; start: NoteRect }
    | { kind: "resize"; key: string; x: number; y: number; start: NoteRect; edges: "e" | "s" | "se" }
    | null
  >(null);
  const paneKeyStr = panes.map((pane) => pane.key).join("|");
  const [notes, setNotes] = useState<Record<string, NoteRect>>(() => {
    const keys = panes.map((pane) => pane.key);
    return mergeNotes(keys, loadNoteLayout(sessionId, window.localStorage).notes);
  });
  const [order, setOrder] = useState<string[]>(() => {
    const keys = panes.map((pane) => pane.key);
    return mergeOrder(loadNoteLayout(sessionId, window.localStorage).order, keys);
  });
  notesRef.current = notes;

  useEffect(() => {
    skipSave.current = true;
    const keys = paneKeyStr.length === 0 ? [] : paneKeyStr.split("|");
    const saved = loadNoteLayout(sessionId, window.localStorage);
    setNotes(mergeNotes(keys, saved.notes));
    setOrder(mergeOrder(saved.order, keys));
  }, [sessionId, paneKeyStr]);

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    if (Object.keys(notes).length === 0) {
      return;
    }
    saveNoteLayout(sessionId, { order, notes }, window.localStorage);
  }, [notes, order, sessionId]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const head = target.closest("[data-note-wheel]");
      if (!head) {
        return;
      }
      const article = head.closest("[data-note-key]");
      const key = article instanceof HTMLElement ? article.dataset.noteKey : undefined;
      const current = key ? notesRef.current[key] : undefined;
      if (!key || !current) {
        return;
      }
      event.preventDefault();
      patchNote(key, wheelResize(current, event.deltaY, event.shiftKey));
    };
    board.addEventListener("wheel", onWheel, { passive: false });
    return () => board.removeEventListener("wheel", onWheel);
  }, []);

  function patchNote(key: string, next: NoteRect): void {
    setNotes((current) => ({ ...current, [key]: next }));
  }

  function bringFront(key: string): void {
    setOrder((current) => raiseNote(current, key));
  }

  function onDragMove(event: ReactPointerEvent<HTMLElement>): void {
    const state = drag.current;
    if (!state || !event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (state.kind === "move") {
      patchNote(state.key, moveNote(state.start, dx, dy));
      return;
    }
    patchNote(state.key, resizeNote(state.start, dx, dy, state.edges));
  }

  function onDragEnd(event: ReactPointerEvent<HTMLElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
  }

  const extent = noteExtent(Object.values(notes));
  const topKey = order[order.length - 1];

  function startResize(
    event: ReactPointerEvent<HTMLElement>,
    key: string,
    start: NoteRect,
    edges: "e" | "s" | "se",
  ): void {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    bringFront(key);
    drag.current = { kind: "resize", key, x: event.clientX, y: event.clientY, start, edges };
  }

  return (
    <div className="split-board" ref={boardRef}>
      <div className="split-board-space" style={{ minWidth: extent.w, minHeight: extent.h }}>
        {panes.map((pane) => {
          const note = notes[pane.key];
          if (!note) {
            return null;
          }
          const box = visibleNote(note);
          const z = order.indexOf(pane.key) + 1;
          return (
            <article
              key={pane.key}
              className={`bot-note${pane.key === topKey ? " is-top" : ""}${note.collapsed ? " collapsed" : ""}`}
              data-note-key={pane.key}
              style={{ left: box.x, top: box.y, width: box.w, height: box.h, zIndex: z }}
              onPointerDown={() => bringFront(pane.key)}
            >
              <header
                className="bot-note-head"
                data-note-wheel
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return;
                  }
                  const target = event.target;
                  if (target instanceof Element && target.closest("button")) {
                    return;
                  }
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = {
                    kind: "move",
                    key: pane.key,
                    x: event.clientX,
                    y: event.clientY,
                    start: note,
                  };
                }}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
                onDoubleClick={(event) => {
                  if ((event.target as Element).closest("button")) {
                    return;
                  }
                  patchNote(pane.key, toggleCollapsed(note));
                }}
              >
                <span
                  className={`agent-dot${paneBusy(pane, codingEvents, botEvents) ? " live" : ""}`}
                  aria-hidden="true"
                />
                <span className="bot-pane-name">@{pane.handle}</span>
                {pane.role === "lead" ? <span className="agent-lead">Lead</span> : null}
                <button
                  type="button"
                  className="note-fold"
                  aria-expanded={!note.collapsed}
                  aria-label={note.collapsed ? "펼치기" : "접기"}
                  onClick={(event) => {
                    event.stopPropagation();
                    patchNote(pane.key, toggleCollapsed(note));
                  }}
                >
                  <Chevron down={note.collapsed} />
                </button>
              </header>
              {note.collapsed ? null : (
                <PaneLog
                  pane={pane}
                  codingEvents={codingEvents}
                  botEvents={botEvents}
                  codingBusy={codingBusy}
                  compact
                  onApprove={onApprove}
                />
              )}
              {note.collapsed ? null : (
                <>
                  <div
                    className="note-resize note-e"
                    data-note-wheel
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="너비 조절"
                    onPointerDown={(event) => startResize(event, pane.key, note, "e")}
                    onPointerMove={onDragMove}
                    onPointerUp={onDragEnd}
                    onPointerCancel={onDragEnd}
                  />
                  <div
                    className="note-resize note-s"
                    data-note-wheel
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="높이 조절"
                    onPointerDown={(event) => startResize(event, pane.key, note, "s")}
                    onPointerMove={onDragMove}
                    onPointerUp={onDragEnd}
                    onPointerCancel={onDragEnd}
                  />
                  <div
                    className="note-resize note-se"
                    data-note-wheel
                    role="separator"
                    aria-label="크기 조절"
                    onPointerDown={(event) => startResize(event, pane.key, note, "se")}
                    onPointerMove={onDragMove}
                    onPointerUp={onDragEnd}
                    onPointerCancel={onDragEnd}
                  />
                </>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function PaneLog({
  pane,
  codingEvents,
  botEvents,
  codingBusy,
  compact,
  onApprove,
}: {
  pane: TeamPane;
  codingEvents: SessionEvent[];
  botEvents: Record<string, SessionEvent[]>;
  codingBusy: boolean;
  compact: boolean;
  onApprove: (sessionId: SessionId, callId: ToolCallId, allow: boolean, remember?: ApprovalRemember) => void;
}) {
  const events = pane.role === "lead" ? codingEvents : (botEvents[pane.sessionId] ?? []);
  const busy = pane.role === "lead" ? codingBusy : hasOpenTurn(events);
  const rows = withThinking(visibleRows(events), busy);
  const sessionId = pane.sessionId as SessionId;
  return (
    <SessionLog
      rows={rows}
      empty={
        pane.role === "lead"
          ? "메시지를 보내면 대화가 시작됩니다."
          : `@${pane.handle} 메일박스`
      }
      compact={compact}
      sessionId={sessionId}
      onApprove={(callId, allow, remember) => onApprove(sessionId, callId, allow, remember)}
    />
  );
}

function paneBusy(
  pane: TeamPane,
  codingEvents: SessionEvent[],
  botEvents: Record<string, SessionEvent[]>,
): boolean {
  const events = pane.role === "lead" ? codingEvents : (botEvents[pane.sessionId] ?? []);
  return hasOpenTurn(events);
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

function isLiveWork(row: ChatRow): boolean {
  if (row.kind === "status") {
    return true;
  }
  if (row.kind === "assistant" || row.kind === "thinking") {
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
