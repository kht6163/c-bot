import { describe, expect, test } from "bun:test";
import { matchesQuery } from "./search.ts";

describe("matchesQuery", () => {
  test("empty query matches everything", () => {
    expect(matchesQuery("Custom / grok-4.6", "")).toBe(true);
    expect(matchesQuery("Custom / grok-4.6", "   ")).toBe(true);
  });

  test("matches case-insensitively and by tokens", () => {
    expect(matchesQuery("Custom / grok-4.6", "GROK")).toBe(true);
    expect(matchesQuery("Custom / grok-4.6", "custom 4.6")).toBe(true);
    expect(matchesQuery("Custom / grok-4.6", "gpt")).toBe(false);
  });
});
