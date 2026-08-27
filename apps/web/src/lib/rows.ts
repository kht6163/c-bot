import type { SessionEvent, ToolCallId, ToolUiKind } from "@cbot/shared";

export type ChatRow =
  | { key: string; kind: "user"; text: string; live: false }
  | { key: string; kind: "assistant"; text: string; live: boolean }
  | { key: string; kind: "peer"; text: string; live: false; handle: string }
  | {
      key: string;
      kind: "tool";
      name: string;
      ui: ToolUiKind;
      arguments: string;
      content: string;
      callId: ToolCallId;
      pendingApproval: boolean;
      ok: boolean;
    };

export function visibleRows(events: readonly SessionEvent[]): ChatRow[] {
  const done = new Set<string>();
  for (const event of events) {
    if (event.type === "assistant/message") {
      done.add(event.turnId);
    }
  }
  const rows: ChatRow[] = [];
  const liveByTurn = new Map<string, string>();
  const toolAt = new Map<string, number>();
  for (const event of events) {
    if (event.type === "user/message") {
      rows.push({ key: `u-${event.seq}`, kind: "user", text: event.text, live: false });
    } else if (event.type === "bot/message") {
      rows.push({
        key: `p-${event.seq}`,
        kind: "peer",
        text: event.text,
        live: false,
        handle: event.fromHandle,
      });
    } else if (event.type === "assistant/chunk" && !done.has(event.turnId)) {
      liveByTurn.set(event.turnId, (liveByTurn.get(event.turnId) ?? "") + event.text);
    } else if (event.type === "assistant/message") {
      liveByTurn.delete(event.turnId);
      if (event.text.length > 0) {
        rows.push({
          key: `a-${event.seq}`,
          kind: "assistant",
          text: event.text,
          live: false,
        });
      }
    } else if (event.type === "tool/call") {
      toolAt.set(event.call.id, rows.length);
      rows.push({
        key: `t-${event.call.id}`,
        kind: "tool",
        name: event.call.name,
        ui: event.call.ui,
        arguments: event.call.arguments,
        content: "",
        callId: event.call.id,
        pendingApproval: false,
        ok: true,
      });
    } else if (event.type === "tool/result") {
      const existing = toolAt.get(event.callId);
      const row: ChatRow = {
        key: `t-${event.callId}`,
        kind: "tool",
        name: existing !== undefined && rows[existing]?.kind === "tool" ? rows[existing].name : "tool",
        ui: existing !== undefined && rows[existing]?.kind === "tool" ? rows[existing].ui : "generic",
        arguments:
          existing !== undefined && rows[existing]?.kind === "tool" ? rows[existing].arguments : "",
        content: event.content,
        callId: event.callId,
        pendingApproval: event.pendingApproval === true,
        ok: event.ok,
      };
      if (existing !== undefined) {
        rows[existing] = row;
      } else {
        toolAt.set(event.callId, rows.length);
        rows.push(row);
      }
    }
  }
  for (const [turnId, text] of liveByTurn) {
    rows.push({ key: `live-${turnId}`, kind: "assistant", text, live: true });
  }
  return rows;
}
