import type { BotToolName } from "@cbot/shared";
import type { BotView } from "./api.ts";
import { toolsOff } from "./bot-tools.ts";
import { shortModelName } from "./thinking.ts";

/** The team panel's selection when it is making a bot rather than editing one. */
export const NEW_BOT = "new";

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
  };
}

export interface DraftChanges {
  basics: boolean;
  model: boolean;
  tools: boolean;
  soul: boolean;
  hidden: boolean;
}

export function draftChanges(saved: BotDraft, draft: BotDraft): DraftChanges {
  return {
    basics: saved.title !== draft.title || saved.description !== draft.description,
    model:
      saved.provider !== draft.provider || saved.model !== draft.model || saved.thinking !== draft.thinking,
    tools: JSON.stringify(saved.tools) !== JSON.stringify(draft.tools),
    soul: saved.soul !== draft.soul,
    hidden: saved.hidden !== draft.hidden,
  };
}

export function isDirty(changes: DraftChanges): boolean {
  return changes.basics || changes.model || changes.tools || changes.soul || changes.hidden;
}

/** The line under a bot in the team list: its model and, once narrowed, how many tools are off. */
export function rosterMeta(draft: Pick<BotDraft, "model" | "tools">): string {
  const model = draft.model ? shortModelName(draft.model) : "기본 모델";
  const off = toolsOff(draft.tools);
  return off > 0 ? `${model} · 도구 ${off}개 끔` : model;
}

/** A skills folder path to show: home as `~`, the long bot id cut in the middle. */
export function shortSkillsPath(path: string): string {
  const homeless = path.replace(/^\/(?:Users|home)\/[^/]+(?=\/)/, "~");
  const trimmed = homeless.replace(/\bbot_([0-9a-f]{4})[0-9a-f-]{8,}([0-9a-f]{4})\b/i, "bot_$1…$2");
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

/** Lines a prompt reads as; the newline every saved SOUL.md ends with is not a line of its own. */
export function lineCount(text: string): number {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.length === 0 ? 0 : body.split("\n").length;
}
