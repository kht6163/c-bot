import { useMemo, type ReactNode } from "react";
import type { ApprovalRemember, SessionEvent, SessionId, ToolCallId } from "@cbot/shared";
import { visibleRows, type ChatRow } from "../lib/rows.ts";
import { normalizeViewMode, teamPanes, type TeamPane, type ViewMode } from "../lib/team.ts";
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
  const canTeam = panes.length > 1;
  const mode: ViewMode = canTeam ? normalizeViewMode(viewMode) : "agent";
  const focused = panes.find((pane) => pane.key === focusedKey) ?? panes[0];

  return (
    <div className="team-stage">
      {canTeam || barEnd ? (
        <div className="stage-bar">
          {!canTeam ? (
            <div className="stage-fill" />
          ) : mode !== "agent" ? (
            <p className="stage-mode-label">그래프 · {panes.length} 봇</p>
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
          {canTeam ? (
            <div className="view-modes" role="group" aria-label="보기">
              {VIEW_MODES.map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  className={mode === item.mode ? "view-mode is-on" : "view-mode"}
                  aria-pressed={mode === item.mode}
                  aria-label={item.label}
                  onClick={() => onViewMode(item.mode)}
                >
                  <ModeIcon mode={item.mode} />
                  <span className="view-mode-label">{item.label}</span>
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

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: "agent", label: "한 화면" },
  { mode: "graph", label: "그래프" },
];

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
        <rect x="1.6" y="2.6" width="10.8" height="8.8" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      )}
    </svg>
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
