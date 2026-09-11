import { describe, expect, test } from "bun:test";
import { BOT_TOOLS } from "@cbot/shared";
import { TOOL_GROUPS, TOOL_HINTS, toggleBotTool, toolsOff } from "./bot-tools.ts";

describe("bot tool picker", () => {
  test("groups show every choice exactly once", () => {
    const shown = TOOL_GROUPS.flatMap((group) => group.tools);
    expect([...shown].sort()).toEqual([...BOT_TOOLS].sort());
    for (const name of [...shown, ...TOOL_GROUPS.flatMap((group) => group.locked ?? [])]) {
      expect(TOOL_HINTS[name as keyof typeof TOOL_HINTS]).toBeTruthy();
    }
  });

  test("switching a tool off from the default lists the rest", () => {
    const next = toggleBotTool(null, "bash");
    expect(next).toEqual(BOT_TOOLS.filter((name) => name !== "bash"));
    expect(toolsOff(next)).toBe(1);
  });

  test("switching the last one back on returns to the default", () => {
    const off = toggleBotTool(null, "bash");
    expect(toggleBotTool(off, "bash")).toBeNull();
    expect(toolsOff(null)).toBe(0);
  });

  test("switching every tool off leaves an empty choice", () => {
    let tools = toggleBotTool(null, BOT_TOOLS[0]);
    for (const name of BOT_TOOLS.slice(1)) {
      tools = toggleBotTool(tools, name);
    }
    expect(tools).toEqual([]);
    expect(toolsOff(tools)).toBe(BOT_TOOLS.length);
  });
});
