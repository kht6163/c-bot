import { describe, expect, test } from "bun:test";
import type { SessionEvent } from "@cbot/shared";
import { asToolCallId, asTurnId } from "@cbot/shared";
import { compactBoundary, contextStart, estimateTokens, historyTokens } from "../src/context.ts";
import { deriveMessages } from "../src/session/derive.ts";

type EventInput = SessionEvent extends infer T
  ? T extends SessionEvent
    ? Omit<T, "seq" | "time">
    : never
  : never;

let seq = 0;
function event(partial: EventInput): SessionEvent {
  seq += 1;
  return { ...partial, seq, time: new Date(seq * 1000).toISOString() } as SessionEvent;
}

function turn(n: number, text: string): SessionEvent[] {
  const turnId = asTurnId(`turn-${n}`);
  return [
    event({ type: "turn/start", turnId }),
    event({ type: "assistant/message", turnId, text, toolCalls: [] }),
    event({ type: "turn/end", turnId }),
  ];
}

describe("estimateTokens", () => {
  test("counts latin text at about four characters per token", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  test("counts CJK heavier than latin of the same length", () => {
    expect(estimateTokens("압축한다")).toBeGreaterThan(estimateTokens("abcd"));
  });

  test("adds per-message overhead and tool arguments", () => {
    const tokens = historyTokens([
      { role: "assistant", content: "", toolCalls: [{ id: "1", name: "bash", arguments: '{"command":"ls"}' }] },
    ]);
    expect(tokens).toBeGreaterThan(4);
  });
});

describe("compactBoundary", () => {
  test("keeps the requested number of recent turns behind the boundary", () => {
    seq = 0;
    const events = [...turn(1, "one"), ...turn(2, "two"), ...turn(3, "three")];
    expect(compactBoundary(events, 0)).toBe(9);
    expect(compactBoundary(events, 1)).toBe(6);
    expect(compactBoundary(events, 2)).toBe(3);
    expect(compactBoundary(events, 3)).toBeNull();
  });

  test("never lands mid-turn, so tool calls keep their results", () => {
    seq = 0;
    const turnId = asTurnId("turn-1");
    const events = [
      event({ type: "turn/start", turnId }),
      event({
        type: "assistant/message",
        turnId,
        text: "",
        toolCalls: [{ id: asToolCallId("c1"), name: "bash", arguments: "{}", ui: "terminal" }],
      }),
      event({ type: "tool/result", turnId, callId: asToolCallId("c1"), ok: true, content: "done" }),
      event({ type: "turn/end", turnId }),
      ...turn(2, "two"),
    ];
    const boundary = compactBoundary(events, 0);
    expect(boundary).toBe(7);
    const kept = events.filter((item) => item.seq <= (boundary ?? 0));
    const messages = deriveMessages(kept);
    const calls = messages.filter((item) => (item.toolCalls?.length ?? 0) > 0).length;
    const results = messages.filter((item) => item.role === "tool").length;
    expect(calls).toBe(results);
  });

  test("does not reach behind an earlier boundary", () => {
    seq = 0;
    const events = [
      ...turn(1, "one"),
      event({ type: "context/clear" }),
      ...turn(2, "two"),
      ...turn(3, "three"),
    ];
    expect(contextStart(events)).toBe(4);
    expect(compactBoundary(events, 2)).toBeNull();
    expect(compactBoundary(events, 1)).toBe(7);
  });
});

describe("deriveMessages after a boundary", () => {
  test("a compact replaces the span it covers with its summary", () => {
    seq = 0;
    const events: SessionEvent[] = [
      event({ type: "user/message", text: "첫 요청", mentions: [] }),
      ...turn(1, "첫 답"),
      event({ type: "context/compact", throughSeq: 4, summary: "요약본", tokensBefore: 12, auto: false }),
      event({ type: "user/message", text: "다음 요청", mentions: [] }),
    ];
    const messages = deriveMessages(events);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toContain("요약본");
    expect(messages[0]?.content).not.toContain("첫 요청");
    expect(messages[1]?.content).toBe("다음 요청");
  });

  test("a clear drops the span with no summary at all", () => {
    seq = 0;
    const events: SessionEvent[] = [
      event({ type: "user/message", text: "첫 요청", mentions: [] }),
      ...turn(1, "첫 답"),
      event({ type: "context/clear" }),
      event({ type: "user/message", text: "다음 요청", mentions: [] }),
    ];
    const messages = deriveMessages(events);
    expect(messages).toEqual([{ role: "user", content: "다음 요청" }]);
  });

  test("the original events stay in the log after a compact", () => {
    seq = 0;
    const events: SessionEvent[] = [
      event({ type: "user/message", text: "첫 요청", mentions: [] }),
      ...turn(1, "첫 답"),
      event({ type: "context/compact", throughSeq: 4, summary: "요약본", tokensBefore: 12, auto: true }),
    ];
    expect(events.filter((item) => item.type === "user/message")).toHaveLength(1);
  });
});
