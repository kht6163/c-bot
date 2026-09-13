import type { BotToolName } from "@cbot/shared";
import type { BotView } from "./api.ts";
import { toolsOff } from "./bot-tools.ts";
import { homePath } from "./path.ts";
import { shortModelName } from "./thinking.ts";

/** The team panel's selection when it is making a bot rather than editing one. */
export const NEW_BOT = "new";

/** UI presets for per-bot idle auto-compact (same `/compact` path on the server). */
export type AutoCompactIdlePreset = "off" | "30s" | "1m" | "5m";

export const AUTO_COMPACT_IDLE_PRESETS: {
  id: AutoCompactIdlePreset;
  label: string;
  ms: number;
}[] = [
  { id: "off", label: "끔", ms: 0 },
  { id: "30s", label: "30초", ms: 30_000 },
  { id: "1m", label: "1분", ms: 60_000 },
  { id: "5m", label: "5분", ms: 300_000 },
];

export function parseAutoCompactIdlePreset(raw: unknown): AutoCompactIdlePreset {
  if (raw === "30s" || raw === "1m" || raw === "5m" || raw === "off") {
    return raw;
  }
  return "off";
}

export function autoCompactIdleFromPreset(preset: AutoCompactIdlePreset): {
  autoCompactIdle: boolean;
  autoCompactIdleMs: number;
} {
  if (preset === "off") {
    return { autoCompactIdle: false, autoCompactIdleMs: 60_000 };
  }
  const ms = AUTO_COMPACT_IDLE_PRESETS.find((item) => item.id === preset)?.ms ?? 60_000;
  return { autoCompactIdle: true, autoCompactIdleMs: ms };
}

export function autoCompactIdlePresetOf(bot: {
  autoCompactIdle: boolean;
  autoCompactIdleMs: number;
}): AutoCompactIdlePreset {
  if (!bot.autoCompactIdle) {
    return "off";
  }
  const hit = AUTO_COMPACT_IDLE_PRESETS.find(
    (item) => item.id !== "off" && item.ms === bot.autoCompactIdleMs,
  );
  return hit?.id ?? "1m";
}

/** What the team panel edits for one bot. Only a new bot edits its handle. */
export interface BotDraft {
  handle: string;
  title: string;
  description: string;
  soul: string;
  provider: string | null;
  model: string | null;
  thinking: string | null;
  hidden: boolean;
  tools: BotToolName[] | null;
  autoCompactIdle: boolean;
  autoCompactIdleMs: number;
}

export function draftOf(bot: BotView): BotDraft {
  return {
    handle: bot.handle,
    title: bot.title,
    description: bot.description,
    soul: bot.soul ?? "",
    provider: bot.provider,
    model: bot.model,
    thinking: bot.thinking,
    hidden: bot.hidden,
    tools: bot.tools ?? null,
    autoCompactIdle: bot.autoCompactIdle === true,
    autoCompactIdleMs: bot.autoCompactIdleMs > 0 ? bot.autoCompactIdleMs : 60_000,
  };
}

export function emptyDraft(): BotDraft {
  return {
    handle: "",
    title: "",
    description: "",
    soul: "",
    provider: null,
    model: null,
    thinking: null,
    hidden: false,
    tools: null,
    autoCompactIdle: false,
    autoCompactIdleMs: 60_000,
  };
}

export interface DraftChanges {
  basics: boolean;
  model: boolean;
  tools: boolean;
  soul: boolean;
  hidden: boolean;
  autoCompact: boolean;
}

export function draftChanges(saved: BotDraft, draft: BotDraft): DraftChanges {
  return {
    basics: saved.title !== draft.title || saved.description !== draft.description,
    model:
      saved.provider !== draft.provider || saved.model !== draft.model || saved.thinking !== draft.thinking,
    tools: JSON.stringify(saved.tools) !== JSON.stringify(draft.tools),
    soul: saved.soul !== draft.soul,
    hidden: saved.hidden !== draft.hidden,
    autoCompact:
      saved.autoCompactIdle !== draft.autoCompactIdle ||
      saved.autoCompactIdleMs !== draft.autoCompactIdleMs,
  };
}

export function isDirty(changes: DraftChanges): boolean {
  return (
    changes.basics ||
    changes.model ||
    changes.tools ||
    changes.soul ||
    changes.hidden ||
    changes.autoCompact
  );
}

/** The line under a bot in the team list: its model and, once narrowed, how many tools are off. */
export function rosterMeta(draft: Pick<BotDraft, "model" | "tools">): string {
  const model = draft.model ? shortModelName(draft.model) : "기본 모델";
  const off = toolsOff(draft.tools);
  return off > 0 ? `${model} · 도구 ${off}개 끔` : model;
}

/** A skills folder path to show: home as `~`, the long bot id cut in the middle. */
export function shortSkillsPath(path: string): string {
  const trimmed = homePath(path).replace(/\bbot_([0-9a-f]{4})[0-9a-f-]{8,}([0-9a-f]{4})\b/i, "bot_$1…$2");
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

/** Lines a prompt reads as; the newline every saved SOUL.md ends with is not a line of its own. */
export function lineCount(text: string): number {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.length === 0 ? 0 : body.split("\n").length;
}
