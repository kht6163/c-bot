import type { SessionEvent } from "@cbot/shared";

export interface ChatRow {
  key: string;
  kind: "user" | "assistant";
  text: string;
  live: boolean;
}

export function visibleRows(events: readonly SessionEvent[]): ChatRow[] {
  const done = new Set<string>();
  for (const event of events) {
    if (event.type === "assistant/message") {
      done.add(event.turnId);
    }
  }
  const rows: ChatRow[] = [];
  const liveByTurn = new Map<string, string>();
  for (const event of events) {
    if (event.type === "user/message") {
      rows.push({ key: `u-${event.seq}`, kind: "user", text: event.text, live: false });
    } else if (event.type === "assistant/chunk" && !done.has(event.turnId)) {
      liveByTurn.set(event.turnId, (liveByTurn.get(event.turnId) ?? "") + event.text);
    } else if (event.type === "assistant/message") {
      liveByTurn.delete(event.turnId);
      rows.push({
        key: `a-${event.seq}`,
        kind: "assistant",
        text: event.text,
        live: false,
      });
    }
  }
  for (const [turnId, text] of liveByTurn) {
    rows.push({ key: `live-${turnId}`, kind: "assistant", text, live: true });
  }
  return rows;
}
