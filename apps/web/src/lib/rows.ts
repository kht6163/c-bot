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
      live: boolean;
    }
  | { key: string; kind: "status"; text: string; live: true };

export function visibleRows(events: readonly SessionEvent[]): ChatRow[] {
  const openTurns = new Set<string>();
  const lastMessageSeq = new Map<string, number>();
  for (const event of events) {
    if (event.type === "turn/start") {
      openTurns.add(event.turnId);
    } else if (event.type === "turn/end") {
      openTurns.delete(event.turnId);
    }
    if (event.type === "assistant/message") {
      lastMessageSeq.set(event.turnId, event.seq);
    }
  }

  const rows: ChatRow[] = [];
  const liveByTurn = new Map<string, string>();
  const toolAt = new Map<string, number>();
  const runningTools = new Map<string, number>();
  const waitingTurns = new Set<string>();

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
    } else if (event.type === "assistant/chunk") {
      const sealed = lastMessageSeq.get(event.turnId) ?? -1;
      if (event.seq > sealed) {
        liveByTurn.set(event.turnId, (liveByTurn.get(event.turnId) ?? "") + event.text);
      }
    } else if (event.type === "assistant/message") {
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
      runningTools.set(event.turnId, (runningTools.get(event.turnId) ?? 0) + 1);
      waitingTurns.delete(event.turnId);
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
        live: true,
      });
    } else if (event.type === "tool/result") {
      const existing = toolAt.get(event.callId);
      const previous = existing !== undefined ? rows[existing] : undefined;
      const row: ChatRow = {
        key: `t-${event.callId}`,
        kind: "tool",
        name: previous?.kind === "tool" ? previous.name : "tool",
        ui: previous?.kind === "tool" ? previous.ui : "generic",
        arguments: previous?.kind === "tool" ? previous.arguments : "",
        content: event.content,
        callId: event.callId,
        pendingApproval: event.pendingApproval === true,
        ok: event.ok,
        live: false,
      };
      if (existing !== undefined) {
        rows[existing] = row;
      } else {
        toolAt.set(event.callId, rows.length);
        rows.push(row);
      }
      if (event.pendingApproval === true) {
        waitingTurns.add(event.turnId);
      } else {
        waitingTurns.delete(event.turnId);
      }
      runningTools.set(event.turnId, Math.max(0, (runningTools.get(event.turnId) ?? 1) - 1));
    }
  }

  for (const [turnId, text] of liveByTurn) {
    if (text.length > 0) {
      rows.push({ key: `live-${turnId}`, kind: "assistant", text, live: true });
    }
  }

  for (const turnId of openTurns) {
    const liveText = liveByTurn.get(turnId) ?? "";
    if (liveText.length > 0 || (runningTools.get(turnId) ?? 0) > 0 || waitingTurns.has(turnId)) {
      continue;
    }
    rows.push({
      key: `live-status-${turnId}`,
      kind: "status",
      text: "생각 중",
      live: true,
    });
  }
  return rows;
}
