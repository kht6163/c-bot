import { describe, expect, test } from "bun:test";
import type { BotView } from "./api.ts";
import {
  draftChanges,
  draftOf,
  emptyDraft,
  isDirty,
  lineCount,
  rosterMeta,
  shortSkillsPath,
} from "./team-panel.ts";

const bot: BotView = {
  id: "bot_1",
  handle: "reviewer",
  title: "Reviewer",
  description: "변경을 읽고 위험을 짚는다",
  role: "specialist",
  provider: "cliproxyapi",
  model: "cliproxyapi/grok-4.6",
  thinking: "high",
  sessionId: "ses_1",
  hidden: false,
  tools: null,
  soul: "# Reviewer\n",
  skills: ["review"],
};

describe("team panel drafts", () => {
  test("a fresh draft of a bot has no changes", () => {
    const saved = draftOf(bot);
    expect(isDirty(draftChanges(saved, draftOf(bot)))).toBe(false);
  });

  test("each edit marks only its own section", () => {
    const saved = draftOf(bot);
    const changes = draftChanges(saved, { ...saved, tools: ["read_file"], soul: "# Reviewer\n\n더\n" });
    expect(changes).toEqual({ basics: false, model: false, tools: true, soul: true, hidden: false });
    expect(draftChanges(saved, { ...saved, thinking: "low" }).model).toBe(true);
    expect(draftChanges(saved, { ...saved, title: "Critic" }).basics).toBe(true);
    expect(draftChanges(saved, { ...saved, hidden: true }).hidden).toBe(true);
  });

  test("a new bot starts with every tool and the default model", () => {
    const draft = emptyDraft();
    expect(draft.tools).toBeNull();
    expect(draft.model).toBeNull();
    expect(rosterMeta(draft)).toBe("기본 모델");
  });
});

describe("rosterMeta", () => {
  test("names the model and counts tools that are off", () => {
    expect(rosterMeta({ model: "cliproxyapi/grok-4.6", tools: null })).toBe("grok-4.6");
    expect(rosterMeta({ model: "grok-4.6", tools: ["read_file", "list_dir", "grep", "glob", "todo_write", "memory", "task"] })).toBe(
      "grok-4.6 · 도구 4개 끔",
    );
  });
});

describe("shortSkillsPath", () => {
  test("shows home as ~ and cuts the bot id in the middle", () => {
    expect(shortSkillsPath("/Users/me/.c-bot/bots/bot_980ab228-74eb-48f7-b784-cf2b8a89c33c/skills")).toBe(
      "~/.c-bot/bots/bot_980a…c33c/skills/",
    );
    expect(shortSkillsPath("/srv/cbot/bots/bot_1/skills/")).toBe("/srv/cbot/bots/bot_1/skills/");
  });
});

describe("lineCount", () => {
  test("ignores the newline a saved prompt ends with", () => {
    expect(lineCount("# Reviewer\n\n변경을 읽는다\n")).toBe(3);
    expect(lineCount("one")).toBe(1);
    expect(lineCount("")).toBe(0);
    expect(lineCount("\n")).toBe(0);
  });
});
