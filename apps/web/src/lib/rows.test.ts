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
      { key: "live-status-trn_1", kind: "status", text: "생각 중", live: true },
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
      expect(row.live).toBe(false);
    }
  });

  test("shows 생각 중 when a turn is open with only turn/start", () => {
    const turnId = asTurnId("trn_open");
    const events: SessionEvent[] = [{ ...envelope(1), type: "turn/start", turnId }];
    expect(visibleRows(events)).toEqual([
      { key: "live-status-trn_open", kind: "status", text: "생각 중", live: true },
    ]);
  });

  test("does not add a status row when live chunks exist", () => {
    const turnId = asTurnId("trn_live");
    const events: SessionEvent[] = [
      { ...envelope(1), type: "turn/start", turnId },
      { ...envelope(2), type: "assistant/chunk", turnId, text: "he" },
      { ...envelope(3), type: "assistant/chunk", turnId, text: "llo" },
    ];
    expect(visibleRows(events)).toEqual([
      { key: "live-trn_live", kind: "assistant", text: "hello", live: true },
    ]);
  });

  test("marks a tool row live until a result arrives", () => {
    const turnId = asTurnId("trn_tool");
    const callId = asToolCallId("call_live");
    const events: SessionEvent[] = [
      {
        ...envelope(1),
        type: "tool/call",
        turnId,
        call: { id: callId, name: "bash", arguments: "{\"command\":\"ls\"}", ui: "terminal" },
      },
    ];
    const rows = visibleRows(events);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.kind).toBe("tool");
    if (row?.kind === "tool") {
      expect(row.live).toBe(true);
    }
  });

  test("keeps chunks after an assistant message while the same turn is open", () => {
    const turnId = asTurnId("trn_step");
    const events: SessionEvent[] = [
      { ...envelope(1), type: "turn/start", turnId },
      {
        ...envelope(2),
        type: "assistant/message",
        turnId,
        text: "먼저 파일을 봅니다.",
        toolCalls: [],
      },
      { ...envelope(3), type: "assistant/chunk", turnId, text: "이어서" },
    ];
    expect(visibleRows(events)).toEqual([
      { key: "a-2", kind: "assistant", text: "먼저 파일을 봅니다.", live: false },
      { key: "live-trn_step", kind: "assistant", text: "이어서", live: true },
    ]);
  });

  test("shows 생각 중 again after a tool result while the turn is still open", () => {
    const turnId = asTurnId("trn_gap");
    const callId = asToolCallId("call_gap");
    const events: SessionEvent[] = [
      { ...envelope(1), type: "turn/start", turnId },
      {
        ...envelope(2),
        type: "tool/call",
        turnId,
        call: { id: callId, name: "read_file", arguments: "{}", ui: "generic" },
      },
      {
        ...envelope(3),
        type: "tool/result",
        turnId,
        callId,
        ok: true,
        content: "ok",
      },
    ];
    const rows = visibleRows(events);
    expect(rows.some((row) => row.kind === "status" && row.text === "생각 중")).toBe(true);
  });
});
