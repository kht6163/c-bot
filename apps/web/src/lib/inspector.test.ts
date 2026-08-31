import { describe, expect, test } from "bun:test";
import {
  INSPECTOR_DEFAULT_W,
  INSPECTOR_MAX_W,
  INSPECTOR_MIN_W,
  clampInspectorWidth,
  loadInspectorWidth,
  saveInspectorWidth,
  widthFromPointer,
} from "./inspector.ts";

function storage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    map,
  };
}

describe("clampInspectorWidth", () => {
  test("holds the floor and the ceiling", () => {
    expect(clampInspectorWidth(10, 1600)).toBe(INSPECTOR_MIN_W);
    expect(clampInspectorWidth(5000, 2400)).toBe(INSPECTOR_MAX_W);
  });

  test("a narrow window leaves the chat its room", () => {
    expect(clampInspectorWidth(600, 1100)).toBe(1100 - 260 - 380);
  });

  test("the floor wins when there is no room at all", () => {
    expect(clampInspectorWidth(600, 700)).toBe(INSPECTOR_MIN_W);
  });
});

describe("widthFromPointer", () => {
  test("the pane is what is left of the pointer", () => {
    expect(widthFromPointer(1200, 1600)).toBe(400);
  });
});

describe("loadInspectorWidth", () => {
  test("an unset or unreadable width falls back to the default", () => {
    expect(loadInspectorWidth(storage(), 1600)).toBe(INSPECTOR_DEFAULT_W);
    expect(loadInspectorWidth(storage({ "cbot.inspector.width": "널" }), 1600)).toBe(
      INSPECTOR_DEFAULT_W,
    );
  });

  test("a saved width comes back clamped to this window", () => {
    const store = storage();
    saveInspectorWidth(500, store);
    expect(loadInspectorWidth(store, 1600)).toBe(500);
    expect(loadInspectorWidth(store, 1000)).toBe(1000 - 260 - 380);
  });
});
