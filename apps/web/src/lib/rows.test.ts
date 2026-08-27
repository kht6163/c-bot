import { describe, expect, test } from "bun:test";
import { asToolCallId, asTurnId, type SessionEvent } from "@cbot/shared";
import { visibleRows } from "./rows.ts";

function envelope(seq: number): { seq: number; time: string } {
  return { seq, time: "2026-01-01T00:00:00.000Z" };
}

describe("visibleRows", () => {
  test("hides chunks once the assistant message for that turn exists", () => {
    const turnId = asTurnId("trn_1");
    const events: SessionEvent[] = [
      { ...envelope(1), type: "user/message", text: "hi", mentions: [] },
      { ...envelope(2), type: "turn/start", turnId },
      { ...envelope(3), type: "assistant/chunk", turnId, text: "he" },
      {
        ...envelope(4),
        type: "assistant/message",
        turnId,
        text: "hello",
        toolCalls: [],
      },
    ];
    expect(visibleRows(events)).toEqual([
      { key: "u-1", kind: "user", text: "hi", live: false },
      { key: "a-4", kind: "assistant", text: "hello", live: false },
    ]);
  });

  test("shows live chunks while the turn is open", () => {
    const turnId = asTurnId("trn_2");
    const events: SessionEvent[] = [
      { ...envelope(1), type: "user/message", text: "hi", mentions: [] },
      { ...envelope(2), type: "assistant/chunk", turnId, text: "he" },
      { ...envelope(3), type: "assistant/chunk", turnId, text: "llo" },
    ];
    expect(visibleRows(events)).toEqual([
      { key: "u-1", kind: "user", text: "hi", live: false },
      { key: "live-trn_2", kind: "assistant", text: "hello", live: true },
    ]);
  });

  test("replaces a pending tool result with the settled result", () => {
    const turnId = asTurnId("trn_3");
    const callId = asToolCallId("call_1");
    const events: SessionEvent[] = [
      {
        ...envelope(1),
        type: "tool/call",
        turnId,
        call: { id: callId, name: "bash", arguments: "{\"command\":\"ls\"}", ui: "terminal" },
      },
      {
        ...envelope(2),
        type: "tool/result",
        turnId,
        callId,
        ok: true,
        content: "승인 대기 중",
        pendingApproval: true,
      },
      {
        ...envelope(3),
        type: "tool/result",
        turnId,
        callId,
        ok: true,
        content: "exit 0\nok",
      },
    ];
    const rows = visibleRows(events);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.kind).toBe("tool");
    if (row?.kind === "tool") {
      expect(row.pendingApproval).toBe(false);
      expect(row.content).toContain("ok");
      expect(row.ui).toBe("terminal");
    }
  });
});
