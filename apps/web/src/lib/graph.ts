import type { SessionEvent } from "@cbot/shared";
import type { TaskView } from "./api.ts";
import { laneOf, type Lane } from "./task-tree.ts";
import type { TeamPane } from "./team.ts";
import { toolHeadline } from "./tool-row.ts";

/**
 * The graph is an overview: each bot is a node with a short ledger of what it
 * just said, ran, and owns. Everything here is a pure projection of the logs
 * and the task board, so the board can be laid out and tested without a DOM.
 */

export const GRAPH_COL_W = 172;
export const GRAPH_COL_GAP = 8;
export const GRAPH_SLOT_H = 292;
export const GRAPH_SLOT_GAP = 40;
export const GRAPH_ROW_GAP = 88;
export const GRAPH_PAD = 28;
export const GRAPH_PER_ROW = 3;
/** A row wider than this splits, so wide slots (many task lanes) stack instead of forcing a tiny fit. */
export const GRAPH_ROW_MAX_W = 1200;
/** Where an edge meets a slot: the avatar centre, measured from the slot's top-left. */
export const GRAPH_ANCHOR_Y = 30;
/** Columns scroll; this only bounds how many rows one column renders. */
export const GRAPH_LIST_MAX = 60;
/** A delivery older than this when first seen is history, not something to animate. */
export const FLIGHT_FRESH_MS = 15_000;
export const FLIGHT_MS = 1_600;

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

export interface GraphFlight {
  id: string;
  from: string;
  to: string;
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

/** Activity and log always show; a task lane only when it holds something. */
export function slotWidth(taskLanes: number): number {
  const cols = 2 + taskLanes;
  return cols * GRAPH_COL_W + (cols - 1) * GRAPH_COL_GAP;
}

/**
 * The lead sits alone at the top; specialists fill rows beneath it, each row
 * centred. Slots keep their own width so a bot with three task lanes gets the
 * room without pushing the others out of line; a row closes when the next
 * slot would push it past `maxRowWidth` or the per-row cap.
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

export function slotAnchor(slot: GraphSlot): GraphPoint {
  return { x: slot.x + slot.w / 2, y: slot.y + GRAPH_ANCHOR_Y };
}

/**
 * A cubic curve that leaves the source downward and arrives at the target
 * from above. A near-vertical edge would run straight through the lead's own
 * columns, so it bows sideways instead.
 */
export function edgePath(from: GraphPoint, to: GraphPoint, index = 0): string {
  const dy = to.y - from.y;
  const lift = Math.max(48, Math.abs(dy) * 0.5);
  const bow = Math.abs(to.x - from.x) < 48 ? (index % 2 === 0 ? 150 : -150) : 0;
  const sign = dy >= 0 ? 1 : -1;
  const cp1 = { x: from.x + bow, y: from.y + lift * sign };
  const cp2 = { x: to.x + bow, y: to.y - lift * sign };
  return `M ${round(from.x)} ${round(from.y)} C ${round(cp1.x)} ${round(cp1.y)}, ${round(cp2.x)} ${round(cp2.y)}, ${round(to.x)} ${round(to.y)}`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Every delivery the open logs know about, as an arrow between two nodes. The
 * receiver is whoever owns the log; the sender is named in the event. A sender
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
      flights.push({ id: event.deliveryId, from, to: pane.key, time: event.time });
    }
  }
  return flights;
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
