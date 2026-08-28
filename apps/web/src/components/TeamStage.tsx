import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { SessionEvent, SessionId, ToolCallId } from "@cbot/shared";
import { visibleRows, type ChatRow } from "../lib/rows.ts";
import { dragSplit, equalWeights, teamPanes, type TeamPane, type ViewMode } from "../lib/team.ts";
import { SessionLog } from "./SessionLog.tsx";

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
  onViewMode: (mode: ViewMode) => void;
  onFocus: (key: string) => void;
  onApprove: (sessionId: SessionId, callId: ToolCallId, allow: boolean) => void;
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
  onViewMode,
  onFocus,
  onApprove,
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
      {canSplit ? (
        <div className="stage-bar">
          {mode === "split" ? (
            <p className="stage-split-label">분할 · {panes.length} 봇</p>
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
          <button
            type="button"
            className="view-toggle"
            aria-pressed={mode === "split"}
            onClick={() => onViewMode(mode === "split" ? "agent" : "split")}
          >
            {mode === "split" ? "한 화면" : "분할"}
          </button>
        </div>
      ) : null}
      {mode === "split" ? (
        <SplitPanes
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

function SplitPanes({
  panes,
  codingEvents,
  botEvents,
  codingBusy,
  onApprove,
}: {
  panes: TeamPane[];
  codingEvents: SessionEvent[];
  botEvents: Record<string, SessionEvent[]>;
  codingBusy: boolean;
  onApprove: (sessionId: SessionId, callId: ToolCallId, allow: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    index: number;
    origin: number;
    size: number;
    base: number[];
    stacked: boolean;
  } | null>(null);
  const keys = panes.map((pane) => pane.key).join("|");
  const [weights, setWeights] = useState(() => equalWeights(panes.length));

  useEffect(() => {
    setWeights(equalWeights(panes.length));
  }, [keys, panes.length]);

  return (
    <div className="split-grid" ref={rootRef}>
      {panes.map((pane, index) => (
        <Fragment key={pane.key}>
          {index > 0 ? (
            <div
              className="split-gutter"
              role="separator"
              aria-orientation="vertical"
              aria-label="칸 크기 조절"
              onPointerDown={(event) => {
                const root = rootRef.current;
                if (!root) {
                  return;
                }
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                const stacked = getComputedStyle(root).flexDirection === "column";
                drag.current = {
                  index: index - 1,
                  origin: stacked ? event.clientY : event.clientX,
                  size: stacked ? root.clientHeight : root.clientWidth,
                  base: weights,
                  stacked,
                };
              }}
              onPointerMove={(event) => {
                const state = drag.current;
                if (!state || !event.currentTarget.hasPointerCapture(event.pointerId)) {
                  return;
                }
                const pos = state.stacked ? event.clientY : event.clientX;
                const delta = (pos - state.origin) / Math.max(1, state.size);
                setWeights(dragSplit(state.base, state.index, delta));
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                drag.current = null;
              }}
            />
          ) : null}
          <div className="split-slot" style={{ flexGrow: weights[index] ?? 1, flexBasis: 0 }}>
          <article className="bot-pane">
            <header className="bot-pane-head">
              <span className="bot-pane-name">@{pane.handle}</span>
              {pane.role === "lead" ? <span className="agent-lead">Lead</span> : null}
              {paneBusy(pane, codingEvents, botEvents) ? (
                <span className="scaffold-pulse" aria-hidden="true" />
              ) : null}
            </header>
            <PaneLog
              pane={pane}
              codingEvents={codingEvents}
              botEvents={botEvents}
              codingBusy={codingBusy}
              compact
              onApprove={onApprove}
            />
          </article>
          </div>
        </Fragment>
      ))}
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
  onApprove: (sessionId: SessionId, callId: ToolCallId, allow: boolean) => void;
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
      onApprove={(callId, allow) => onApprove(sessionId, callId, allow)}
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
