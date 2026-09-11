import { useEffect, useMemo, useRef, useState } from "react";
import { hasOpenTurn, type SessionEvent, type SessionId } from "@cbot/shared";
import { fetchTasks, type TaskView } from "../lib/api.ts";
import {
  FLIGHT_MS,
  GRAPH_LIST_MAX,
  avatarText,
  edgePath,
  freshFlights,
  graphLayout,
  messageFlights,
  nodeActivity,
  nodeLog,
  nodeTaskLanes,
  slotAnchor,
  slotWidth,
  type GraphFlight,
  type GraphSlot,
} from "../lib/graph.ts";
import { timeAgo } from "../lib/path.ts";
import type { TeamPane } from "../lib/team.ts";

interface Props {
  sessionId: SessionId;
  panes: TeamPane[];
  codingEvents: SessionEvent[];
  botEvents: Record<string, SessionEvent[]>;
  codingBusy: boolean;
  /** Bumps when the task board may have changed; the graph re-reads it then. */
  boardTick: number;
  onOpen: (key: string) => void;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.4;
const ZOOM_STEP = 0.15;
/** Room the board keeps around the drawing when fitting to width. */
const FIT_INSET = 24;

type Zoom = number | "fit";

/**
 * The team as a map: the lead over its specialists, an edge for every pair
 * that has exchanged a message, and a spark that runs the edge when a new
 * message lands. Under each node hang the last few things it said, ran, and
 * owns. It is an overview; a node click opens that bot's full log.
 */
export function TeamGraph({
  sessionId,
  panes,
  codingEvents,
  botEvents,
  codingBusy,
  boardTick,
  onOpen,
}: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<string>());
  const mounted = useRef(true);
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [boardWidth, setBoardWidth] = useState(0);
  const [flying, setFlying] = useState<GraphFlight[]>([]);

  useEffect(() => {
    let stale = false;
    void fetchTasks(sessionId)
      .then((next) => {
        if (!stale) {
          setTasks(next);
        }
      })
      .catch(() => {
        // The board is optional here; the 작업 panel reports the error itself.
      });
    return () => {
      stale = true;
    };
  }, [sessionId, boardTick]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) {
      return;
    }
    const measure = () => setBoardWidth(board.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    return () => observer.disconnect();
  }, []);

  const nodes = useMemo(
    () =>
      panes.map((pane) => {
        const events = pane.role === "lead" ? codingEvents : (botEvents[pane.sessionId] ?? []);
        const lanes = nodeTaskLanes(pane.handle, tasks);
        return {
          pane,
          busy: pane.role === "lead" ? codingBusy : hasOpenTurn(events),
          activity: nodeActivity(pane, events),
          log: nodeLog(events),
          lanes,
          w: slotWidth(lanes.length),
        };
      }),
    [panes, codingEvents, botEvents, codingBusy, tasks],
  );

  const layout = useMemo(() => graphLayout(nodes.map((node) => ({ key: node.pane.key, w: node.w }))), [nodes]);
  const slotOf = useMemo(() => new Map(layout.slots.map((slot) => [slot.key, slot])), [layout]);
  const indexOf = useMemo(() => new Map(panes.map((pane, index) => [pane.key, index])), [panes]);

  const allFlights = useMemo(() => messageFlights(panes, codingEvents, botEvents), [panes, codingEvents, botEvents]);

  // Every event re-derives the flight list, so the timer that lands a spark
  // must outlive this effect: clearing it on re-run would keep sparks forever.
  useEffect(() => {
    const fresh = freshFlights(allFlights, seen.current, Date.now());
    for (const flight of allFlights) {
      seen.current.add(flight.id);
    }
    if (fresh.length === 0 || prefersReducedMotion()) {
      return;
    }
    setFlying((current) => [...current, ...fresh]);
    const gone = new Set(fresh.map((flight) => flight.id));
    setTimeout(() => {
      if (mounted.current) {
        setFlying((current) => current.filter((flight) => !gone.has(flight.id)));
      }
    }, FLIGHT_MS + 200);
  }, [allFlights]);

  const scale =
    zoom === "fit"
      ? layout.width > 0
        ? Math.max(ZOOM_MIN, Math.min(1, (boardWidth - FIT_INSET) / layout.width))
        : 1
      : zoom;

  /** One curve per pair; a message either way rides the same curve, reversed when needed. */
  const pairPath = (a: string, b: string): { d: string; first: string } | undefined => {
    const [first, second] = (indexOf.get(a) ?? 0) <= (indexOf.get(b) ?? 0) ? [a, b] : [b, a];
    const from = slotOf.get(first);
    const to = slotOf.get(second);
    if (!from || !to) {
      return undefined;
    }
    return { d: edgePath(slotAnchor(from), slotAnchor(to), indexOf.get(second) ?? 0), first };
  };

  const edges = useMemo(() => {
    const keys = new Set<string>();
    const lead = panes[0];
    const list: { key: string; a: string; b: string }[] = [];
    const add = (a: string, b: string) => {
      const key = [a, b].sort().join("|");
      if (!keys.has(key)) {
        keys.add(key);
        list.push({ key, a, b });
      }
    };
    if (lead) {
      for (const pane of panes.slice(1)) {
        add(lead.key, pane.key);
      }
    }
    for (const flight of allFlights) {
      add(flight.from, flight.to);
    }
    return list;
  }, [panes, allFlights]);

  const busyKeys = new Set(nodes.filter((node) => node.busy).map((node) => node.pane.key));
  const flyingPairs = new Set(flying.map((flight) => [flight.from, flight.to].sort().join("|")));

  return (
    <div className="graph-board" ref={boardRef}>
      <div
        className="graph-scroll"
        style={{ width: Math.ceil(layout.width * scale), height: Math.ceil(layout.height * scale) }}
      >
        <div
          className="graph-space"
          style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}
        >
          <svg className="graph-edges" width={layout.width} height={layout.height} aria-hidden="true">
            {edges.map((edge) => {
              const pair = pairPath(edge.a, edge.b);
              if (!pair) {
                return null;
              }
              const active = flyingPairs.has(edge.key) || busyKeys.has(edge.a) || busyKeys.has(edge.b);
              return (
                <g key={edge.key} className={active ? "graph-edge is-active" : "graph-edge"}>
                  <path className="graph-edge-glow" d={pair.d} />
                  <path className="graph-edge-line" d={pair.d} />
                </g>
              );
            })}
            {flying.map((flight) => {
              const pair = pairPath(flight.from, flight.to);
              if (!pair) {
                return null;
              }
              const reversed = pair.first !== flight.from;
              return (
                <g key={flight.id} className="graph-spark">
                  <circle r="8" className="graph-spark-halo" />
                  <circle r="3" className="graph-spark-core" />
                  <animateMotion
                    dur={`${FLIGHT_MS}ms`}
                    path={pair.d}
                    keyPoints={reversed ? "1;0" : "0;1"}
                    keyTimes="0;1"
                    calcMode="linear"
                    fill="freeze"
                  />
                </g>
              );
            })}
          </svg>
          {nodes.map((node) => {
            const slot = slotOf.get(node.pane.key);
            return slot ? (
              <GraphNode key={node.pane.key} node={node} slot={slot} onOpen={() => onOpen(node.pane.key)} />
            ) : null;
          })}
        </div>
      </div>
      <div className="graph-zoom" role="group" aria-label="확대">
        <button
          type="button"
          aria-label="축소"
          onClick={() => setZoom(Math.max(ZOOM_MIN, round(scale - ZOOM_STEP)))}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 6h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" className={zoom === "fit" ? "is-on" : ""} onClick={() => setZoom("fit")}>
          맞춤
        </button>
        <button
          type="button"
          aria-label="확대"
          onClick={() => setZoom(Math.min(ZOOM_MAX, round(scale + ZOOM_STEP)))}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 6h7M6 2.5v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type GraphNodeData = {
  pane: TeamPane;
  busy: boolean;
  activity: ReturnType<typeof nodeActivity>;
  log: ReturnType<typeof nodeLog>;
  lanes: ReturnType<typeof nodeTaskLanes>;
};

function GraphNode({ node, slot, onOpen }: { node: GraphNodeData; slot: GraphSlot; onOpen: () => void }) {
  const { pane } = node;
  return (
    <article
      className={`graph-slot${pane.role === "lead" ? " is-lead" : ""}`}
      style={{ left: slot.x, top: slot.y, width: slot.w, height: slot.h }}
    >
      <button
        type="button"
        className={`graph-node${node.busy ? " is-live" : ""}`}
        title={`@${pane.handle} 대화 열기`}
        onClick={onOpen}
      >
        <span className="graph-avatar" aria-hidden="true">
          {pane.role === "lead" ? <LeadMark /> : avatarText(pane.handle)}
        </span>
        <span className="graph-handle">@{pane.handle}</span>
        <span className="graph-role">{pane.role === "lead" ? "Lead" : pane.title}</span>
      </button>
      <div className="graph-cols">
        <section className="graph-col">
          <p className="graph-col-label">
            활동 <Count value={node.activity.length} />
          </p>
          {node.activity.length === 0 ? <p className="graph-none">아직 없음</p> : null}
          <ul className="graph-list">
            {node.activity.slice(0, GRAPH_LIST_MAX).map((item) => (
              <li key={item.key} className="graph-item" title={item.text}>
                <span className="graph-item-head">
                  <span className="graph-chip">{item.from}</span>
                  {item.to ? (
                    <>
                      <span className="graph-to" aria-hidden="true">
                        →
                      </span>
                      <span className="graph-chip">{item.to}</span>
                    </>
                  ) : null}
                  <span className="graph-time">{timeAgo(item.time)}</span>
                </span>
                <span className="graph-item-text">{item.text}</span>
              </li>
            ))}
            <More count={node.activity.length - GRAPH_LIST_MAX} />
          </ul>
        </section>
        <section className="graph-col">
          <p className="graph-col-label">
            로그 <Count value={node.log.length} />
          </p>
          {node.log.length === 0 ? <p className="graph-none">아직 없음</p> : null}
          <ul className="graph-list">
            {node.log.slice(0, GRAPH_LIST_MAX).map((item) => (
              <li key={item.key} className={`graph-item is-${item.kind}`} title={item.detail || undefined}>
                <span className="graph-item-head">
                  <span className={`graph-mark is-${item.state}`} aria-hidden="true" />
                  <span className="graph-tool">{item.name}</span>
                  <span className="graph-time">{timeAgo(item.time)}</span>
                </span>
                {item.detail ? <span className="graph-item-text mono">{item.detail}</span> : null}
              </li>
            ))}
            <More count={node.log.length - GRAPH_LIST_MAX} />
          </ul>
        </section>
        {node.lanes.map((lane) => (
          <section key={lane.lane} className={`graph-col graph-lane is-${lane.lane}`}>
            <p className="graph-col-label">
              {lane.label} <Count value={lane.tasks.length + lane.more} />
            </p>
            <ul className="graph-list">
              {lane.tasks.map((task) => (
                <li key={task.id} className="graph-task" title={task.title}>
                  <span className="graph-task-dot" aria-hidden="true" />
                  <span className="graph-task-body">
                    <span className="graph-task-title">{task.title}</span>
                    <span className="graph-task-meta">
                      {task.requesterHandle !== task.ownerHandle ? `@${task.requesterHandle} 요청 · ` : ""}
                      {timeAgo(task.updatedAt)}
                    </span>
                  </span>
                </li>
              ))}
              <More count={lane.more} />
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}

function Count({ value }: { value: number }) {
  return value > 0 ? <span className="graph-count">{value}</span> : null;
}

/** Past the render cap; the full list is one click away in the bot's own log. */
function More({ count }: { count: number }) {
  return count > 0 ? <li className="graph-more">+{count}</li> : null;
}

function LeadMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M11 2.2 19 6.6v8.8L11 19.8 3 15.4V6.6z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="11" cy="11" r="2.5" fill="currentColor" />
    </svg>
  );
}
