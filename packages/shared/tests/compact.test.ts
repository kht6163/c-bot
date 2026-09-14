import { describe, expect, test } from "bun:test";
import {
  AUTO_COMPACT_IDLE_MAX_MS,
  AUTO_COMPACT_IDLE_MIN_MS,
  DEFAULT_AUTO_COMPACT_IDLE_MS,
  autoCompactIdleMsOf,
  autoCompactIdleParts,
  clampAutoCompactIdleMs,
  isIdleUnit,
} from "../src/compact.ts";

describe("clampAutoCompactIdleMs", () => {
  test("keeps a typed wait inside the range instead of letting it read as off", () => {
    expect(clampAutoCompactIdleMs(90_000)).toBe(90_000);
    expect(clampAutoCompactIdleMs(0)).toBe(AUTO_COMPACT_IDLE_MIN_MS);
    expect(clampAutoCompactIdleMs(-5)).toBe(AUTO_COMPACT_IDLE_MIN_MS);
    expect(clampAutoCompactIdleMs(AUTO_COMPACT_IDLE_MAX_MS * 3)).toBe(AUTO_COMPACT_IDLE_MAX_MS);
    expect(clampAutoCompactIdleMs(1_500.6)).toBe(AUTO_COMPACT_IDLE_MIN_MS);
    expect(clampAutoCompactIdleMs(12_345.6)).toBe(12_346);
    expect(clampAutoCompactIdleMs(Number.NaN)).toBe(DEFAULT_AUTO_COMPACT_IDLE_MS);
  });
});

describe("idle wait parts", () => {
  test("reads back as the largest whole unit it divides into", () => {
    expect(autoCompactIdleParts(45_000)).toEqual({ value: 45, unit: "sec" });
    expect(autoCompactIdleParts(90_000)).toEqual({ value: 90, unit: "sec" });
    expect(autoCompactIdleParts(300_000)).toEqual({ value: 5, unit: "min" });
    expect(autoCompactIdleParts(7_200_000)).toEqual({ value: 2, unit: "hour" });
  });

  test("a typed count round-trips through the unit it was typed in", () => {
    expect(autoCompactIdleMsOf(90, "sec")).toBe(90_000);
    expect(autoCompactIdleParts(autoCompactIdleMsOf(90, "sec"))).toEqual({ value: 90, unit: "sec" });
    expect(autoCompactIdleMsOf(3, "min")).toBe(180_000);
    expect(autoCompactIdleMsOf(48, "hour")).toBe(AUTO_COMPACT_IDLE_MAX_MS);
    // A count under one unit is one unit, then the range decides.
    expect(autoCompactIdleMsOf(0.2, "sec")).toBe(AUTO_COMPACT_IDLE_MIN_MS);
    expect(autoCompactIdleMsOf(0.2, "min")).toBe(60_000);
    expect(autoCompactIdleMsOf(Number.NaN, "min")).toBe(DEFAULT_AUTO_COMPACT_IDLE_MS);
  });

  test("only the three units are units", () => {
    expect(isIdleUnit("min")).toBe(true);
    expect(isIdleUnit("day")).toBe(false);
    expect(isIdleUnit(60)).toBe(false);
  });
});
