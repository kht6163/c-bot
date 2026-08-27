import { describe, expect, test } from "bun:test";
import { asTurnId, type SessionEvent } from "@cbot/shared";
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
});
