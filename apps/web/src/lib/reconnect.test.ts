import { describe, expect, test } from "bun:test";
import { RECONNECT_BASE_MS, RECONNECT_MAX_MS, reconnectDelay } from "./reconnect.ts";

describe("reconnectDelay", () => {
  test("waits before the first retry", () => {
    expect(reconnectDelay(1)).toBe(RECONNECT_BASE_MS);
    expect(reconnectDelay(0)).toBe(RECONNECT_BASE_MS);
  });

  test("backs off and stops at the cap", () => {
    expect(reconnectDelay(2)).toBe(800);
    expect(reconnectDelay(99)).toBe(RECONNECT_MAX_MS);
    let previous = 0;
    for (let attempt = 1; attempt <= 20; attempt++) {
      const delay = reconnectDelay(attempt);
      expect(delay).toBeGreaterThanOrEqual(previous);
      expect(delay).toBeLessThanOrEqual(RECONNECT_MAX_MS);
      previous = delay;
    }
  });
});
