import { newTurnId, type SessionEvent, type SessionId } from "@cbot/shared";
import type { LlmClient } from "./llm/client.ts";
import { LlmError } from "./llm/client.ts";
import { CODING_SYSTEM_PROMPT } from "./prompt.ts";
import { deriveMessages } from "./session/derive.ts";
import type { SessionStore } from "./session/store.ts";

const CHUNK_FLUSH_MS = 40;

export interface TurnContext {
  store: SessionStore;
  llm: LlmClient;
  apiKey: string | undefined;
  baseURL: string;
  model: string;
  systemPrompt?: string;
}

export async function runTurn(sessionId: SessionId, ctx: TurnContext): Promise<void> {
  const turnId = newTurnId();
  ctx.store.append(sessionId, { type: "turn/start", turnId });
  if (!ctx.apiKey) {
    ctx.store.append(sessionId, {
      type: "assistant/message",
      turnId,
      text: "[reason: missing_config] XAI_API_KEY가 없습니다. 설정에서 키를 넣으세요.",
      toolCalls: [],
    });
    ctx.store.append(sessionId, { type: "turn/end", turnId });
    return;
  }
  const history = deriveMessages(ctx.store.events(sessionId));
  const system = ctx.systemPrompt ?? CODING_SYSTEM_PROMPT;
  let full = "";
  let pending = "";
  let lastFlush = Date.now();
  const flush = (force: boolean) => {
    if (pending.length === 0) {
      return;
    }
    const now = Date.now();
    if (!force && now - lastFlush < CHUNK_FLUSH_MS) {
      return;
    }
    ctx.store.append(sessionId, { type: "assistant/chunk", turnId, text: pending });
    pending = "";
    lastFlush = now;
  };
  try {
    for await (const event of ctx.llm.stream({
      baseURL: ctx.baseURL,
      apiKey: ctx.apiKey,
      model: ctx.model,
      system,
      messages: history,
    })) {
      if (event.type === "text") {
        full += event.text;
        pending += event.text;
        flush(false);
      }
    }
    flush(true);
    ctx.store.append(sessionId, {
      type: "assistant/message",
      turnId,
      text: full,
      toolCalls: [],
    });
  } catch (err) {
    const reason = err instanceof LlmError ? err.reason : "unknown";
    const detail = err instanceof Error ? err.message : String(err);
    ctx.store.append(sessionId, {
      type: "assistant/message",
      turnId,
      text: `[reason: ${reason}] ${detail}`,
      toolCalls: [],
    });
  }
  ctx.store.append(sessionId, { type: "turn/end", turnId });
}

/** True when a user or bot message sits after the last finished turn. */
export function sessionNeedsTurn(events: readonly SessionEvent[]): boolean {
  let lastTurnEnd = 0;
  let lastInput = 0;
  for (const event of events) {
    if (event.type === "turn/end") {
      lastTurnEnd = event.seq;
    }
    if (event.type === "user/message" || event.type === "bot/message") {
      lastInput = event.seq;
    }
  }
  return lastInput > lastTurnEnd;
}

export function titleFromText(text: string): string {
  const oneLine = text.trim().split(/\r?\n/, 1)[0] ?? "";
  if (oneLine.length <= 40) {
    return oneLine || "새 세션";
  }
  return `${oneLine.slice(0, 40)}…`;
}
