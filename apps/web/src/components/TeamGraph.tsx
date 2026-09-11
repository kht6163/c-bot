import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { hasOpenTurn, type SessionEvent, type SessionId } from "@cbot/shared";
import { fetchTasks, type TaskView } from "../lib/api.ts";
import {
  ARRANGE_MS,
  FLIGHT_MS,
  GRAPH_LIST_MAX,
  GRAPH_SLOT_W,
  HANDOFF_AT,
  HANDOFF_MS,
  autoPlacements,
  avatarText,
  curvePath,
  curvePoint,
  dragPlacement,
  easeInOut,
  edgeCurve,
  flightProgress,
  freshFlights,
  handoffCards,
  loadGraphPlacements,
  messageFlights,
  nodeActivity,
  nodeLog,
  nodeTaskLanes,
  placeSlots,
  placedLayout,
  samePlacements,
  saveGraphPlacements,
  slotAnchor,
  tweenPlacements,
  type GraphCurve,
  type GraphFlight,
  type GraphPlacement,
  type GraphPlacements,
  type GraphSlot,
} from "../lib/graph.ts";
import { timeAgo } from "../lib/path.ts";
import type { NoteStorage, TeamPane } from "../lib/team.ts";
import { LeadMark } from "./LeadMark.tsx";

interface Props {
  sessionId: SessionId;
  panes: TeamPane[];
  codingEvents: SessionEvent[];
  botEvents: Record<string, SessionEvent[]>;
  codingBusy: boolean;
  /** Bumps when the task board may have changed; the graph re-reads it then. */
  boardTick: number;
  /** The full log of one bot, for the side panel a node click opens. */
  renderPane: (pane: TeamPane) => ReactNode;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.4;
const ZOOM_STEP = 0.15;
/** Room the board keeps around the drawing when fitting to width. */
const FIT_INSET = 24;
/** Sparks leaving together on one batch are staggered so they read as separate messages. */
const FLIGHT_STAGGER_MS = 280;
/** The ring a spark leaves on the node it lands on. */
const LANDING_MS = 520;
const TRAIL = 7;
const TRAIL_STEP = 0.022;
/** The message card sits to the right of the receiver's avatar, clear of its name. */
const HANDOFF_OFFSET_X = 58;
/** Screen pixels the pointer must travel before a press on a node becomes a drag. */
const DRAG_SLOP = 4;

type Zoom = number | "fit";

interface Flying extends GraphFlight {
  /** `performance.now()` when the spark leaves. */
  start: number;
  /**
   * How long after it mounts the card waits to show, fixed at launch: a CSS
   * delay recomputed on a later render would shift an animation already running.
   */
  cardDelay: number;
}

interface Spark extends Flying {
  curve: GraphCurve;
}

/** The slot in hand, and the board size and zoom frozen when it was picked up. */
interface Held {
  key: string;
  at: GraphPlacement;
  scale: number;
  width: number;
  height: number;
}

/**
 * The team as a map: the lead over its specialists, an edge for every pair
 * that has exchanged a message, and a spark that runs the edge when a new
 * message or hand-off lands. Under each node hang scrollable columns of what
 * it said, ran, and owns. A node click opens that bot's full log beside the
 * map without leaving it. Bots stay where they were put: the user drags them,
 * and only 자동 정렬 lays the board out again.
 */
export function TeamGraph({ sessionId, panes, codingEvents, botEvents, codingBusy, boardTick, renderPane }: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<string>());
  const mounted = useRef(true);
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [boardWidth, setBoardWidth] = useState(0);
  const [flying, setFlying] = useState<Flying[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState<GraphPlacements>(() => loadGraphPlacements(sessionId, layoutStorage()));
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const [held, setHeld] = useState<Held | null>(null);
  const [glide, setGlide] = useState<GraphPlacements | null>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  const glideFrame = useRef(0);
  const swallowClick = useRef(false);

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
      stopDrag.current?.();
      cancelAnimationFrame(glideFrame.current);
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

  const selectedPane = panes.find((pane) => pane.key === selected);

  useEffect(() => {
    if (!selectedPane) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      // A sheet or drawer over the graph takes the Esc for itself.
      if (event.key === "Escape" && !typing && !event.defaultPrevented) {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedPane]);

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
        };
      }),
    [panes, codingEvents, botEvents, codingBusy, tasks],
  );

  const paneKeys = panes.map((pane) => pane.key).join("\n");
  const slotList = useMemo(
    () => (paneKeys ? paneKeys.split("\n") : []).map((key) => ({ key, w: GRAPH_SLOT_W })),
    [paneKeys],
  );
  const placements = useMemo(() => placeSlots(slotList, saved), [slotList, saved]);
  const tidy = useMemo(() => autoPlacements(slotList), [slotList]);

  const remember = (next: GraphPlacements) => {
    savedRef.current = next;
    setSaved(next);
    saveGraphPlacements(sessionId, next, layoutStorage());
  };

  // A bot seen for the first time has its spot written down at once, so the
  // next one to join cannot shift it.
  useEffect(() => {
    if (Object.keys(placements).some((key) => !(key in savedRef.current))) {
      remember({ ...savedRef.current, ...placements });
    }
  }, [placements]);

  const shown = glide ?? (held ? { ...placements, [held.key]: held.at } : placements);
  const layout = placedLayout(slotList, shown);
  const slotOf = new Map(layout.slots.map((slot) => [slot.key, slot]));
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
    const now = performance.now();
    const batch = fresh.map((flight, index) => ({
      ...flight,
      start: now + index * FLIGHT_STAGGER_MS,
      cardDelay: Math.round(index * FLIGHT_STAGGER_MS + FLIGHT_MS * HANDOFF_AT),
    }));
    setFlying((current) => [...current, ...batch]);
    const gone = new Set(batch.map((flight) => flight.id));
    setTimeout(
      () => {
        if (mounted.current) {
          setFlying((current) => current.filter((flight) => !gone.has(flight.id)));
        }
      },
      Math.max(FLIGHT_MS + LANDING_MS, FLIGHT_MS * HANDOFF_AT + HANDOFF_MS) +
        (batch.length - 1) * FLIGHT_STAGGER_MS +
        100,
    );
  }, [allFlights]);

  const fitScale =
    layout.width > 0 ? Math.max(ZOOM_MIN, Math.min(1, (boardWidth - FIT_INSET) / layout.width)) : 1;
  // While a slot is in hand the board keeps the size and zoom it had when the
  // drag began: re-fitting under the pointer would pull the slot away from it.
  const scale = held ? held.scale : zoom === "fit" ? fitScale : zoom;
  const box = held ? { width: held.width, height: held.height } : layout;
  const arranged = samePlacements(slotList.map((slot) => slot.key), placements, tidy);

  const grab = (event: ReactPointerEvent<HTMLElement>, key: string) => {
    const from = placements[key];
    if (event.button !== 0 || glide || !from) {
      return;
    }
    // Keeps the press from selecting text or moving focus while the slot is in hand.
    event.preventDefault();
    const pointer = event.pointerId;
    const origin = { x: event.clientX, y: event.clientY };
    const frozen = { scale, width: layout.width, height: layout.height };
    let moved = false;
    const landing = (move: PointerEvent) =>
      dragPlacement(from, (move.clientX - origin.x) / frozen.scale, (move.clientY - origin.y) / frozen.scale);
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== pointer) {
        return;
      }
      if (!moved && Math.hypot(move.clientX - origin.x, move.clientY - origin.y) < DRAG_SLOP) {
        return;
      }
      moved = true;
      setHeld({ key, at: landing(move), ...frozen });
    };
    const finish = (end: PointerEvent) => {
      if (end.pointerId !== pointer) {
        return;
      }
      stop();
      if (!moved) {
        return;
      }
      // The click that ends a drag is neither a node click nor a board click.
      swallowClick.current = true;
      window.setTimeout(() => {
        swallowClick.current = false;
      }, 0);
      setHeld(null);
      if (end.type === "pointerup") {
        remember({ ...savedRef.current, [key]: landing(end) });
      }
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      stopDrag.current = null;
    };
    stopDrag.current?.();
    stopDrag.current = stop;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const arrange = () => {
    const from = placements;
    remember({ ...savedRef.current, ...tidy });
    cancelAnimationFrame(glideFrame.current);
    if (prefersReducedMotion()) {
      setGlide(null);
      return;
    }
    const begin = performance.now();
    setGlide(from);
    const step = (time: number) => {
      if (!mounted.current) {
        return;
      }
      const t = Math.min(1, (time - begin) / ARRANGE_MS);
      setGlide(t < 1 ? tweenPlacements(from, tidy, easeInOut(t)) : null);
      if (t < 1) {
        glideFrame.current = requestAnimationFrame(step);
      }
    };
    glideFrame.current = requestAnimationFrame(step);
  };

  /** One curve per pair, drawn from the earlier pane to the later one. */
  const pairCurve = (a: string, b: string): { curve: GraphCurve; first: string } | undefined => {
    const [first, second] = (indexOf.get(a) ?? 0) <= (indexOf.get(b) ?? 0) ? [a, b] : [b, a];
    const from = slotOf.get(first);
    const to = slotOf.get(second);
    if (!from || !to) {
      return undefined;
    }
    return { curve: edgeCurve(slotAnchor(from), slotAnchor(to), indexOf.get(second) ?? 0), first };
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
  const linked = new Set(
    selected
      ? edges.flatMap((edge) => (edge.a === selected ? [edge.b] : edge.b === selected ? [edge.a] : []))
      : [],
  );
  const flyingPairs = new Set(flying.map((flight) => [flight.from, flight.to].sort().join("|")));

  // A spark rides its pair's curve; one flying the other way rides it reversed.
  const sparks: Spark[] = flying.flatMap((flight) => {
    const pair = pairCurve(flight.from, flight.to);
    if (!pair) {
      return [];
    }
    const { from, c1, c2, to } = pair.curve;
    const curve = pair.first === flight.from ? pair.curve : { from: to, c1: c2, c2: c1, to: from };
    return [{ ...flight, curve }];
  });

  const closeOnBackground = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!swallowClick.current && target instanceof Element && !target.closest(".graph-slot")) {
      setSelected(null);
    }
  };

  return (
    <div className={`graph-view${selectedPane ? " has-panel" : ""}${held ? " is-dragging" : ""}`}>
      <div className="graph-main">
        <div className="graph-board" ref={boardRef} onClick={closeOnBackground}>
          <div
            className="graph-scroll"
            style={{ width: Math.ceil(box.width * scale), height: Math.ceil(box.height * scale) }}
          >
            <div
              className={`graph-space${selectedPane ? " has-focus" : ""}`}
              style={{ width: box.width, height: box.height, transform: `scale(${scale})` }}
            >
              <svg className="graph-edges" width={box.width} height={box.height} aria-hidden="true">
                {edges.map((edge) => {
                  const pair = pairCurve(edge.a, edge.b);
                  if (!pair) {
                    return null;
                  }
                  const d = curvePath(pair.curve);
                  const active = flyingPairs.has(edge.key) || busyKeys.has(edge.a) || busyKeys.has(edge.b);
                  const focus = selected === edge.a || selected === edge.b;
                  const className = [
                    "graph-edge",
                    active ? "is-active" : "",
                    selected ? (focus ? "is-focus" : "is-faded") : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <g key={edge.key} className={className}>
                      <path className="graph-edge-glow" d={d} />
                      <path className="graph-edge-line" d={d} />
                    </g>
                  );
                })}
              </svg>
              {nodes.map((node) => {
                const slot = slotOf.get(node.pane.key);
                return slot ? (
                  <GraphNode
                    key={node.pane.key}
                    node={node}
                    slot={slot}
                    selected={selected === node.pane.key}
                    dim={selected !== null && selected !== node.pane.key && !linked.has(node.pane.key)}
                    dragging={held?.key === node.pane.key}
                    onGrab={(event) => grab(event, node.pane.key)}
                    onSelect={() => {
                      if (!swallowClick.current) {
                        setSelected((current) => (current === node.pane.key ? null : node.pane.key));
                      }
                    }}
                  />
                ) : null;
              })}
              {/* Edges run behind the columns like the reference, but a spark must
                  stay in sight the whole way, so it flies on a layer above them. */}
              <svg className="graph-sparks-layer" width={box.width} height={box.height} aria-hidden="true">
                <defs>
                  <radialGradient id="graph-spark-glow">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.9" />
                    <stop offset="45%" stopColor="var(--accent)" stopOpacity="0.32" />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <GraphSparks sparks={sparks} scale={scale} />
              </svg>
              {handoffCards(flying).map((flight) => {
                const slot = slotOf.get(flight.to);
                const from = panes.find((pane) => pane.key === flight.from);
                const to = panes.find((pane) => pane.key === flight.to);
                if (!slot || !from || !to) {
                  return null;
                }
                const anchor = slotAnchor(slot);
                return (
                  <div
                    key={flight.id}
                    className={`graph-handoff is-${flight.kind}`}
                    style={{
                      left: anchor.x + HANDOFF_OFFSET_X,
                      top: slot.y + 4,
                      transform: `scale(${1 / Math.min(1, scale)})`,
                      animationDuration: `${HANDOFF_MS}ms`,
                      animationDelay: `${flight.cardDelay}ms`,
                    }}
                    aria-hidden="true"
                  >
                    <span className="graph-item-head">
                      <span className="graph-chip">@{from.handle}</span>
                      <span className="graph-to">→</span>
                      <span className="graph-chip">@{to.handle}</span>
                    </span>
                    <span className="graph-handoff-text">{flight.preview}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="graph-tools">
          <button
            type="button"
            className="graph-arrange"
            disabled={arranged}
            title="리드를 위 가운데에, 나머지 봇을 그 아래 줄에 다시 놓습니다"
            onClick={arrange}
          >
            <ArrangeIcon />
            자동 정렬
          </button>
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
      </div>
      {selectedPane ? (
        <aside className="graph-panel" aria-label={`@${selectedPane.handle} 대화`}>
          <header className="graph-panel-head">
            <span className={`graph-panel-avatar${busyKeys.has(selectedPane.key) ? " is-live" : ""}`} aria-hidden="true">
              {selectedPane.role === "lead" ? <LeadMark size={14} /> : avatarText(selectedPane.handle)}
            </span>
            <span className="bot-pane-name">@{selectedPane.handle}</span>
            <span className="graph-panel-role">{selectedPane.role === "lead" ? "Lead" : selectedPane.title}</span>
            <button type="button" className="graph-panel-close" aria-label="닫기" onClick={() => setSelected(null)}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="m3 3 6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          {renderPane(selectedPane)}
          {selectedPane.role === "specialist" ? (
            <p className="graph-panel-hint">보기 전용 · 메시지는 리드에게 보냅니다</p>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function layoutStorage(): NoteStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    // Storage blocked outright: the layout works, it just is not remembered.
    return undefined;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Sparks move on a frame loop rather than SMIL: an `<animateMotion>` added
 * after its `<svg>` has been on screen resolves its begin time against the
 * svg's own clock and jumps straight to the end. Only this group re-renders
 * per frame, and the loop runs only while something is in the air.
 */
function GraphSparks({ sparks, scale }: { sparks: Spark[]; scale: number }) {
  const [, setFrame] = useState(0);
  const active = sparks.length > 0;

  useEffect(() => {
    if (!active) {
      return;
    }
    let frame = requestAnimationFrame(function tick(time) {
      setFrame(time);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  // Read the clock on every render, not from the last frame: a render caused
  // by a new spark must place it now, not at the time of a stale frame.
  const now = performance.now();

  // Drawn at layout size and scaled with the board, so undo the zoom-out to
  // keep the spark and its label legible on screen.
  const k = 1 / Math.min(1, scale);
  return (
    <g className="graph-sparks">
      {sparks.map((spark) => {
        const elapsed = now - spark.start;
        if (elapsed < 0) {
          return null;
        }
        if (elapsed >= FLIGHT_MS) {
          const land = Math.min(1, (elapsed - FLIGHT_MS) / LANDING_MS);
          return (
            <circle
              key={spark.id}
              className="graph-landing"
              cx={spark.curve.to.x}
              cy={spark.curve.to.y}
              r={(20 + land * 18) * Math.sqrt(k)}
              opacity={0.55 * (1 - land)}
            />
          );
        }
        const t = flightProgress(elapsed);
        const head = curvePoint(spark.curve, t);
        const labelOpacity = Math.min(1, t / 0.12, (1 - t) / 0.12);
        return (
          <g key={spark.id} className={`graph-spark is-${spark.kind}`}>
            {Array.from({ length: TRAIL }, (_, index) => {
              const step = index + 1;
              const point = curvePoint(spark.curve, t - step * TRAIL_STEP);
              return (
                <circle
                  key={step}
                  className="graph-spark-trail"
                  cx={point.x}
                  cy={point.y}
                  r={(3.4 - step * 0.38) * k}
                  opacity={0.55 * (1 - step / (TRAIL + 1))}
                />
              );
            })}
            <circle className="graph-spark-halo" cx={head.x} cy={head.y} r={16 * k} />
            {spark.kind === "task" ? (
              <rect
                className="graph-spark-core"
                x={head.x - 4.5 * k}
                y={head.y - 3.5 * k}
                width={9 * k}
                height={7 * k}
                rx={2 * k}
              />
            ) : (
              <circle className="graph-spark-core" cx={head.x} cy={head.y} r={3.6 * k} />
            )}
            {spark.label ? (
              <text
                className="graph-spark-label"
                x={head.x}
                y={head.y - 14 * k}
                fontSize={11 * k}
                strokeWidth={4 * k}
                opacity={labelOpacity}
              >
                {spark.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

type GraphNodeData = {
  pane: TeamPane;
  busy: boolean;
  activity: ReturnType<typeof nodeActivity>;
  log: ReturnType<typeof nodeLog>;
  lanes: ReturnType<typeof nodeTaskLanes>;
};

function GraphNode({
  node,
  slot,
  selected,
  dim,
  dragging,
  onGrab,
  onSelect,
}: {
  node: GraphNodeData;
  slot: GraphSlot;
  selected: boolean;
  /** Another bot is open and this one does not talk to it. */
  dim: boolean;
  dragging: boolean;
  onGrab: (event: ReactPointerEvent<HTMLElement>) => void;
  onSelect: () => void;
}) {
  const { pane } = node;
  const classes = [
    "graph-slot",
    pane.role === "lead" ? "is-lead" : "",
    selected ? "is-selected" : "",
    dim ? "is-dim" : "",
    dragging ? "is-dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <article className={classes} style={{ left: slot.x, top: slot.y, width: slot.w, height: slot.h }}>
      <div className="graph-slot-head" onPointerDown={onGrab}>
        <button
          type="button"
          className={`graph-node${node.busy ? " is-live" : ""}`}
          aria-pressed={selected}
          title={`${selected ? "대화 닫기" : `@${pane.handle} 대화 보기`} · 끌어서 옮기기`}
          onClick={onSelect}
        >
          <span className="graph-avatar" aria-hidden="true">
            {pane.role === "lead" ? <LeadMark size={20} /> : avatarText(pane.handle)}
            {node.busy ? (
              <span className="graph-orbit">
                <i />
                <i />
                <i />
                <i />
              </span>
            ) : null}
          </span>
          <span className="graph-handle">@{pane.handle}</span>
          <span className="graph-role">{pane.role === "lead" ? "Lead" : pane.title}</span>
        </button>
      </div>
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
        <section className="graph-col">
          <p className="graph-col-label">
            작업 <Count value={node.lanes.reduce((sum, lane) => sum + lane.tasks.length + lane.more, 0)} />
          </p>
          {node.lanes.length === 0 ? <p className="graph-none">아직 없음</p> : null}
          <ul className="graph-list">
            {node.lanes.map((lane) => (
              <li key={lane.lane} className={`graph-lane is-${lane.lane}`}>
                <p className="graph-lane-label">
                  {lane.label} <Count value={lane.tasks.length + lane.more} />
                </p>
                <ul className="graph-lane-tasks">
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
              </li>
            ))}
          </ul>
        </section>
      </div>
    </article>
  );
}

function Count({ value }: { value: number }) {
  return value > 0 ? <span className="graph-count">{value}</span> : null;
}

/** Past the render cap; the full list is one click away in the side panel. */
function More({ count }: { count: number }) {
  return count > 0 ? <li className="graph-more">+{count}</li> : null;
}

/** A node over two: the tidy tree 자동 정렬 lays out. */
function ArrangeIcon() {
  return (
    <svg className="bar-icon" width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="5" y="1.5" width="4" height="3" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1.5" y="9.5" width="4" height="3" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8.5" y="9.5" width="4" height="3" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 4.5V7M3.5 9.5V7h7v2.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
