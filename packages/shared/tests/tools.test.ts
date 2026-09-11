import { describe, expect, test } from "bun:test";
import { BOT_TOOLS, botToolEnabled, isBotToolName, normalizeBotTools } from "../src/tools.ts";

describe("bot tool choice", () => {
  test("keeps known names once each in catalog order", () => {
    expect(normalizeBotTools(["bash", "read_file", "bash", "nope"])).toEqual(["read_file", "bash"]);
  });

  test("choosing every tool is the default, stored as null", () => {
    expect(normalizeBotTools([...BOT_TOOLS].reverse())).toBeNull();
  });

  test("choosing none keeps an empty list, which is not the default", () => {
    expect(normalizeBotTools([])).toEqual([]);
    expect(botToolEnabled([], "read_file")).toBe(false);
  });

  test("null enables every tool, a list only its own", () => {
    expect(botToolEnabled(null, "bash")).toBe(true);
    expect(botToolEnabled(["read_file"], "read_file")).toBe(true);
    expect(botToolEnabled(["read_file"], "bash")).toBe(false);
  });

  test("message_agent is not a choice: every bot keeps it", () => {
    expect(isBotToolName("message_agent")).toBe(false);
    expect(isBotToolName("grep")).toBe(true);
  });
});
