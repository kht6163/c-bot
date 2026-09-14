import { describe, expect, test } from "bun:test";
import { idleCompactReady, lastActivityMs, maxEventSeq } from "../src/idle-compact.ts";

describe("idleCompactReady", () => {
  test("requires enabled + idle elapsed + compactAt threshold", () => {
    const base = {
      enabled: true,
      idleMs: 30_000,
      lastActivityMs: 1_000,
      nowMs: 40_000,
      tokens: 900,
      maxTokens: 1000,
      compactAt: 0.8,
    };
    expect(idleCompactReady(base)).toBe(true);
    expect(idleCompactReady({ ...base, enabled: false })).toBe(false);
    expect(idleCompactReady({ ...base, nowMs: 20_000 })).toBe(false);
    expect(idleCompactReady({ ...base, tokens: 700 })).toBe(false);
  });
});

describe("activity helpers", () => {
  test("last activity and max seq follow the log", () => {
    expect(lastActivityMs([], 42)).toBe(42);
    expect(
      lastActivityMs(
        [{ time: "2020-01-01T00:00:00.000Z" }, { time: "2020-01-01T00:01:00.000Z" }],
        0,
      ),
    ).toBe(Date.parse("2020-01-01T00:01:00.000Z"));
    expect(maxEventSeq([{ seq: 1 }, { seq: 7 }, { seq: 3 }])).toBe(7);
  });
});
