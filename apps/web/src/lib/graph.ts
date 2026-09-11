import type { SessionEvent } from "@cbot/shared";
import type { TaskView } from "./api.ts";
import { laneOf, type Lane } from "./task-tree.ts";
import type { NoteStorage, TeamPane } from "./team.ts";
import { toolHeadline } from "./tool-row.ts";

/**
 * The graph is an overview: each bot is a node with a short ledger of what it
 * just said, ran, and owns. Everything here is a pure projection of the logs
 * and the task board, so the board can be laid out and tested without a DOM.
 */

export const GRAPH_COL_W = 172;
export const GRAPH_COL_GAP = 8;
/**
 * Every slot is the same three columns wide (활동, 로그, 작업), whatever it
 * holds: a slot that grew when its first job landed would shove its row
 * sideways or run into a neighbour the user placed by hand.
 */
export const GRAPH_SLOT_W = 3 * GRAPH_COL_W + 2 * GRAPH_COL_GAP;
export const GRAPH_SLOT_H = 292;
export const GRAPH_SLOT_GAP = 40;
export const GRAPH_ROW_GAP = 88;
export const GRAPH_PAD = 28;
export const GRAPH_PER_ROW = 3;
/** A row wider than this splits, so wide slots (many task lanes) stack instead of forcing a tiny fit. */
export const GRAPH_ROW_MAX_W = 1200;
/** Where an edge meets a slot: the avatar centre, measured from the slot's top-left. */
export const GRAPH_ANCHOR_Y = 30;
/** Dragged slots land on this grid, so hand-placed rows line up. */
export const GRAPH_SNAP = 8;
/** How long 자동 정렬 takes to glide every slot to its tidy spot. */
export const ARRANGE_MS = 360;
/** Columns scroll; this only bounds how many rows one column renders. */
export const GRAPH_LIST_MAX = 60;
/** A delivery older than this when first seen is history, not something to animate. */
export const FLIGHT_FRESH_MS = 15_000;
/** How long a spark takes to cross its edge, slow enough to follow the label it carries. */
export const FLIGHT_MS = 4_800;
export const FLIGHT_LABEL_MAX = 44;
export const FLIGHT_PREVIEW_MAX = 180;
/** The message card shows up when the spark is this far along, and lingers after. */
export const HANDOFF_AT = 0.58;
export const HANDOFF_MS = 3_200;

export interface GraphActivityItem {
  key: string;
  from: string;
  to: string;
  text: string;
  time: string;
}

export interface GraphLogItem {
  key: string;
  kind: "tool" | "thinking";
  name: string;
  detail: string;
  state: "live" | "ok" | "fail";
  time: string;
}

export interface GraphTaskLane {
  lane: Lane;
  label: string;
  tasks: TaskView[];
  more: number;
}

export interface GraphSlot {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GraphLayout {
  width: number;
  height: number;
  slots: GraphSlot[];
}

export interface GraphPoint {
  x: number;
  y: number;
}

/** Top-left of a slot on the board, in layout pixels. */
export type GraphPlacement = GraphPoint;
export type GraphPlacements = Record<string, GraphPlacement>;

export interface GraphCurve {
  from: GraphPoint;
  c1: GraphPoint;
  c2: GraphPoint;
  to: GraphPoint;
}

export interface GraphFlight {
  id: string;
  kind: "message" | "task";
  from: string;
  to: string;
  /** Rides the spark along the edge. */
  label: string;
  /** Fills the card that pops up beside the receiver. */
  preview: string;
  time: string;
}

export const USER_LABEL = "사용자";

const LANE_LABEL: Record<Lane, string> = {
  in_progress: "진행 중",
  pending: "대기",
  done: "끝난 일",
};

const LANE_ORDER: Lane[] = ["in_progress", "pending", "done"];

/** The mailbox text carries the server's attribution line; the card already names the sender. */
export function stripAttribution(text: string): string {
  return text.replace(/^Message from [^\n]*\(@[^)\n]+\):\n\n/, "");
}

function oneLine(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * What passed through this bot's mailbox, newest first: the user's asks (lead
 * only), teammates' messages, and the bot's own answers. Chunks and tool
 * traffic belong to the log column.
 */
export function nodeActivity(pane: TeamPane, events: readonly SessionEvent[]): GraphActivityItem[] {
  const items: GraphActivityItem[] = [];
  for (const event of events) {
    if (event.type === "user/message") {
      items.push({
        key: `u-${event.seq}`,
        from: USER_LABEL,
        to: `@${pane.handle}`,
        text: oneLine(event.text),
        time: event.time,
      });
    } else if (event.type === "bot/message") {
      items.push({
        key: `p-${event.seq}`,
        from: `@${event.fromHandle}`,
        to: `@${pane.handle}`,
        text: oneLine(stripAttribution(event.text)),
        time: event.time,
      });
    } else if (event.type === "assistant/message" && event.text.trim().length > 0) {
      items.push({
        key: `a-${event.seq}`,
        from: `@${pane.handle}`,
        to: pane.role === "lead" ? USER_LABEL : "",
        text: oneLine(event.text),
        time: event.time,
      });
    }
  }
  return items.reverse();
}

/** Tool calls with their outcome, plus thinking, newest first. */
export function nodeLog(events: readonly SessionEvent[]): GraphLogItem[] {
  const items: GraphLogItem[] = [];
  const at = new Map<string, number>();
  const thinking = new Map<string, { index: number; raw: string }>();
  for (const event of events) {
    if (event.type === "tool/call") {
      at.set(event.call.id, items.length);
      items.push({
        key: `t-${event.call.id}`,
        kind: "tool",
        name: event.call.name,
        detail: oneLine(toolHeadline(event.call.arguments), 80),
        state: "live",
        time: event.time,
      });
    } else if (event.type === "tool/result") {
      const index = at.get(event.callId);
      const item = index === undefined ? undefined : items[index];
      if (item && !event.pendingApproval) {
        item.state = event.ok ? "ok" : "fail";
      }
    } else if (event.type === "assistant/thinking") {
      const open = thinking.get(event.turnId);
      const item = open ? items[open.index] : undefined;
      if (open && item) {
        open.raw += event.text;
        item.detail = oneLine(open.raw, 80);
      } else {
        thinking.set(event.turnId, { index: items.length, raw: event.text });
        items.push({
          key: `th-${event.turnId}`,
          kind: "thinking",
          name: "thinking",
          detail: oneLine(event.text, 80),
          state: "ok",
          time: event.time,
        });
      }
    } else if (event.type === "turn/end") {
      for (const [id, index] of at) {
        const item = items[index];
        if (item && item.state === "live") {
          item.state = "fail";
          at.delete(id);
        }
      }
    }
  }
  return items.reverse();
}

/** The bot's own jobs, one lane per status that has any, capped per lane. */
export function nodeTaskLanes(
  handle: string,
  tasks: readonly TaskView[],
  cap = GRAPH_LIST_MAX,
): GraphTaskLane[] {
  const own = tasks.filter((task) => task.ownerHandle === handle);
  return LANE_ORDER.flatMap((lane) => {
    const inLane = own
      .filter((task) => laneOf(task) === lane)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (inLane.length === 0) {
      return [];
    }
    return [
      {
        lane,
        label: LANE_LABEL[lane],
        tasks: inLane.slice(0, cap),
        more: Math.max(0, inLane.length - cap),
      },
    ];
  });
}

/**
 * The lead sits alone at the top; specialists fill rows beneath it, each row
 * centred. A row closes when the next slot would push it past `maxRowWidth`
 * or the per-row cap.
 */
export function graphLayout(
  slots: readonly { key: string; w: number }[],
  maxRowWidth = GRAPH_ROW_MAX_W,
): GraphLayout {
  const [lead, ...rest] = slots;
  if (!lead) {
    return { width: 0, height: 0, slots: [] };
  }
  const rowWidth = (row: readonly { w: number }[]) =>
    row.reduce((sum, slot) => sum + slot.w, 0) + Math.max(0, row.length - 1) * GRAPH_SLOT_GAP;
  const rows: { key: string; w: number }[][] = [];
  for (const slot of rest) {
    const row = rows[rows.length - 1];
    if (row && row.length < GRAPH_PER_ROW && rowWidth([...row, slot]) <= maxRowWidth) {
      row.push(slot);
    } else {
      rows.push([slot]);
    }
  }
  const inner = Math.max(lead.w, ...rows.map(rowWidth));
  const width = inner + GRAPH_PAD * 2;
  const centre = width / 2;
  const placed: GraphSlot[] = [
    { key: lead.key, x: Math.round(centre - lead.w / 2), y: GRAPH_PAD, w: lead.w, h: GRAPH_SLOT_H },
  ];
  let y = GRAPH_PAD + GRAPH_SLOT_H + GRAPH_ROW_GAP;
  for (const row of rows) {
    let x = centre - rowWidth(row) / 2;
    for (const slot of row) {
      placed.push({ key: slot.key, x: Math.round(x), y, w: slot.w, h: GRAPH_SLOT_H });
      x += slot.w + GRAPH_SLOT_GAP;
    }
    y += GRAPH_SLOT_H + GRAPH_ROW_GAP;
  }
  const height = y - GRAPH_ROW_GAP + GRAPH_PAD;
  return { width, height, slots: placed };
}

export function autoPlacements(
  slots: readonly { key: string; w: number }[],
  maxRowWidth = GRAPH_ROW_MAX_W,
): GraphPlacements {
  return Object.fromEntries(graphLayout(slots, maxRowWidth).slots.map((slot) => [slot.key, { x: slot.x, y: slot.y }]));
}

function collides(a: GraphSlot, b: GraphSlot, gap: number): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/**
 * Where every slot sits. A saved spot always wins, so nothing moves on its
 * own. A slot seen for the first time takes the spot auto layout would give
 * it when that spot is free, and otherwise joins a row under everything
 * already placed. With nothing saved, this is the auto layout.
 */
export function placeSlots(
  slots: readonly { key: string; w: number }[],
  saved: Readonly<GraphPlacements>,
): GraphPlacements {
  const auto = autoPlacements(slots);
  const placed: GraphPlacements = {};
  const boxes: GraphSlot[] = [];
  for (const slot of slots) {
    const spot = saved[slot.key];
    if (spot) {
      placed[slot.key] = spot;
      boxes.push({ key: slot.key, ...spot, w: slot.w, h: GRAPH_SLOT_H });
    }
  }
  if (boxes.length === 0) {
    return auto;
  }
  const below = Math.max(...boxes.map((box) => box.y + box.h)) + GRAPH_ROW_GAP;
  let row = { x: GRAPH_PAD, y: below };
  for (const slot of slots) {
    if (placed[slot.key]) {
      continue;
    }
    const want = auto[slot.key] ?? row;
    let spot = want;
    if (boxes.some((box) => collides({ key: slot.key, ...want, w: slot.w, h: GRAPH_SLOT_H }, box, GRAPH_SLOT_GAP / 2))) {
      if (row.x > GRAPH_PAD && row.x + slot.w > GRAPH_PAD + GRAPH_ROW_MAX_W) {
        row = { x: GRAPH_PAD, y: row.y + GRAPH_SLOT_H + GRAPH_ROW_GAP };
      }
      spot = row;
      row = { x: row.x + slot.w + GRAPH_SLOT_GAP, y: row.y };
    }
    placed[slot.key] = spot;
    boxes.push({ key: slot.key, ...spot, w: slot.w, h: GRAPH_SLOT_H });
  }
  return placed;
}

/** The board around placed slots: as wide and tall as they reach, plus the margin. */
export function placedLayout(
  slots: readonly { key: string; w: number }[],
  placements: Readonly<GraphPlacements>,
): GraphLayout {
  const placed = slots.flatMap((slot) => {
    const at = placements[slot.key];
    return at ? [{ key: slot.key, x: at.x, y: at.y, w: slot.w, h: GRAPH_SLOT_H }] : [];
  });
  if (placed.length === 0) {
    return { width: 0, height: 0, slots: [] };
  }
  return {
    width: Math.max(...placed.map((slot) => slot.x + slot.w)) + GRAPH_PAD,
    height: Math.max(...placed.map((slot) => slot.y + slot.h)) + GRAPH_PAD,
    slots: placed,
  };
}

/**
 * Where a dragged slot lands: moved by the pointer's travel (already divided
 * by the zoom), snapped to the grid, and kept off the board's top and left edge.
 */
export function dragPlacement(start: GraphPlacement, dx: number, dy: number, snap = GRAPH_SNAP): GraphPlacement {
  const land = (value: number) => Math.max(0, Math.round(value / snap) * snap);
  return { x: land(start.x + dx), y: land(start.y + dy) };
}

/** Part way from one arrangement to another; a slot only in `to` is already there. */
export function tweenPlacements(
  from: Readonly<GraphPlacements>,
  to: Readonly<GraphPlacements>,
  t: number,
): GraphPlacements {
  const out: GraphPlacements = {};
  for (const [key, end] of Object.entries(to)) {
    const begin = from[key] ?? end;
    out[key] = { x: begin.x + (end.x - begin.x) * t, y: begin.y + (end.y - begin.y) * t };
  }
  return out;
}

export function samePlacements(
  keys: readonly string[],
  a: Readonly<GraphPlacements>,
  b: Readonly<GraphPlacements>,
): boolean {
  return keys.every((key) => a[key]?.x === b[key]?.x && a[key]?.y === b[key]?.y);
}

export function graphStorageKey(sessionId: string): string {
  return `cbot.graph.v1.${sessionId}`;
}

export function parseGraphPlacements(raw: string | null): GraphPlacements {
  if (!raw) {
    return {};
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // A corrupt entry is dropped; the board falls back to auto layout.
    return {};
  }
  const stored = data && typeof data === "object" ? (data as { placements?: unknown }).placements : undefined;
  if (!stored || typeof stored !== "object") {
    return {};
  }
  const out: GraphPlacements = {};
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    const { x, y } = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) {
      out[key] = { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) };
    }
  }
  return out;
}

export function loadGraphPlacements(sessionId: string, storage: NoteStorage | undefined): GraphPlacements {
  try {
    return parseGraphPlacements(storage?.getItem(graphStorageKey(sessionId)) ?? null);
  } catch {
    // Storage the browser refuses to read: start from auto layout.
    return {};
  }
}

export function saveGraphPlacements(
  sessionId: string,
  placements: Readonly<GraphPlacements>,
  storage: NoteStorage | undefined,
): void {
  try {
    storage?.setItem(graphStorageKey(sessionId), JSON.stringify({ v: 1, placements }));
  } catch {
    // Quota or private mode: the layout is just not remembered.
  }
}

export function slotAnchor(slot: GraphSlot): GraphPoint {
  return { x: slot.x + slot.w / 2, y: slot.y + GRAPH_ANCHOR_Y };
}

/**
 * A cubic curve that leaves the source downward and arrives at the target
 * from above. A near-vertical edge would run straight through the lead's own
 * columns, so it bows sideways instead.
 */
export function edgeCurve(from: GraphPoint, to: GraphPoint, index = 0): GraphCurve {
  const dy = to.y - from.y;
  const lift = Math.max(48, Math.abs(dy) * 0.5);
  const bow = Math.abs(to.x - from.x) < 48 ? (index % 2 === 0 ? 150 : -150) : 0;
  const sign = dy >= 0 ? 1 : -1;
  return {
    from,
    c1: { x: from.x + bow, y: from.y + lift * sign },
    c2: { x: to.x + bow, y: to.y - lift * sign },
    to,
  };
}

export function curvePath({ from, c1, c2, to }: GraphCurve): string {
  return `M ${round(from.x)} ${round(from.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(to.x)} ${round(to.y)}`;
}

export function edgePath(from: GraphPoint, to: GraphPoint, index = 0): string {
  return curvePath(edgeCurve(from, to, index));
}

/** Where a spark is at `t` (0 at `from`, 1 at `to`), clamped to the curve. */
export function curvePoint({ from, c1, c2, to }: GraphCurve, t: number): GraphPoint {
  const u = Math.min(1, Math.max(0, t));
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  return {
    x: a * from.x + b * c1.x + c * c2.x + d * to.x,
    y: a * from.y + b * c1.y + c * c2.y + d * to.y,
  };
}

/** Cubic ease-in-out on 0..1. */
export function easeInOut(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
}

/** Eases in and out, so a spark leaves and lands instead of sliding at one speed. */
export function flightProgress(elapsed: number, duration = FLIGHT_MS): number {
  return easeInOut(elapsed / duration);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Every hand-off the open logs know about, as an arrow between two nodes.
 * Deliveries: the receiver is whoever owns the log, the sender is named in the
 * event. Board changes (always in the coding session's log): a job handed to
 * someone else flies requester to owner, and finishing it flies back. An end
 * that is not on this session's team (a hidden bot, say) is dropped, since it
 * has no node to fly from.
 */
export function messageFlights(
  panes: readonly TeamPane[],
  codingEvents: readonly SessionEvent[],
  botEvents: Readonly<Record<string, readonly SessionEvent[]>>,
): GraphFlight[] {
  const byHandle = new Map(panes.map((pane) => [pane.handle, pane.key]));
  const flights: GraphFlight[] = [];
  for (const pane of panes) {
    const events = pane.role === "lead" ? codingEvents : (botEvents[pane.sessionId] ?? []);
    for (const event of events) {
      if (event.type !== "bot/message") {
        continue;
      }
      const from = byHandle.get(event.fromHandle);
      if (!from || from === pane.key) {
        continue;
      }
      const text = stripAttribution(event.text);
      flights.push({
        id: event.deliveryId,
        kind: "message",
        from,
        to: pane.key,
        label: oneLine(text, FLIGHT_LABEL_MAX),
        preview: oneLine(text, FLIGHT_PREVIEW_MAX),
        time: event.time,
      });
    }
  }
  const status = new Map<string, string>();
  for (const event of codingEvents) {
    if (event.type !== "task/change") {
      continue;
    }
    const was = status.get(event.taskId);
    status.set(event.taskId, event.status);
    const owner = byHandle.get(event.ownerHandle);
    const requester = byHandle.get(event.requesterHandle);
    if (!owner || !requester || owner === requester) {
      continue;
    }
    const handed = event.action === "add";
    const finished = event.action === "update" && event.status === "completed" && was !== "completed";
    if (!handed && !finished) {
      continue;
    }
    const said = `${handed ? "작업" : "완료"} · ${event.title}`;
    flights.push({
      id: `task-${event.seq}`,
      kind: "task",
      from: handed ? requester : owner,
      to: handed ? owner : requester,
      label: oneLine(said, FLIGHT_LABEL_MAX),
      preview: oneLine(said, FLIGHT_PREVIEW_MAX),
      time: event.time,
    });
  }
  return flights;
}

/**
 * The newest card per receiver: a node shows one message at a time, so a
 * later hand-off to the same bot replaces the card instead of stacking it.
 */
export function handoffCards<T extends { to: string; start: number }>(flying: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const flight of flying) {
    const held = latest.get(flight.to);
    if (!held || flight.start >= held.start) {
      latest.set(flight.to, flight);
    }
  }
  return [...latest.values()];
}

/**
 * Which of these flights should fly now: unseen, and recent enough to be news
 * rather than a log that just finished loading.
 */
export function freshFlights(
  flights: readonly GraphFlight[],
  seen: ReadonlySet<string>,
  now: number,
): GraphFlight[] {
  return flights.filter(
    (flight) => !seen.has(flight.id) && now - Date.parse(flight.time) <= FLIGHT_FRESH_MS,
  );
}

/**
 * Two mono letters stand in for a face: no emoji, no avatar files. First and
 * last, so `test2` and `test3` do not wear the same badge.
 */
export function avatarText(handle: string): string {
  const clean = handle.replace(/[^a-z0-9가-힣]/gi, "") || handle;
  const first = clean.charAt(0);
  const last = clean.length > 1 ? clean.charAt(clean.length - 1) : "";
  return `${first}${last}`.toUpperCase();
}
