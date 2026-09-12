import { describe, expect, test } from "bun:test";
import {
  autoCompactIdleFromPreset,
  autoCompactIdlePresetOf,
  idleCompactReady,
  lastActivityMs,
  maxEventSeq,
  parseAutoCompactIdlePreset,
} from "../src/idle-compact.ts";

describe("idle compact presets", () => {
  test("off is the default parse and disables the feature", () => {
    expect(parseAutoCompactIdlePreset("nope")).toBe("off");
    expect(autoCompactIdleFromPreset("off")).toEqual({
      autoCompactIdle: false,
      autoCompactIdleMs: 60_000,
    });
    expect(autoCompactIdleFromPreset("30s")).toEqual({
      autoCompactIdle: true,
      autoCompactIdleMs: 30_000,
    });
    expect(autoCompactIdlePresetOf({ autoCompactIdle: false, autoCompactIdleMs: 30_000 })).toBe("off");
    expect(autoCompactIdlePresetOf({ autoCompactIdle: true, autoCompactIdleMs: 300_000 })).toBe("5m");
  });
});

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
