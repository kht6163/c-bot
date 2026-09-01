import type { DeliveryReason, SessionId } from "@cbot/shared";
import { compactBoundary, historyTokens } from "./context.ts";
import { LlmError, type LlmClient } from "./llm/client.ts";
import { deriveMessages } from "./session/derive.ts";
import type { SessionStore } from "./session/store.ts";

export const COMPACT_SYSTEM = [
  "You compress a coding session so the same agent can keep working from the summary alone.",
  "Write the summary in the language the conversation used.",
  "Cover, in this order and only when the conversation has them:",
  "1. what the user asked for, including constraints they stated,",
  "2. decisions already made and why,",
  "3. files created or edited, with their paths,",
  "4. commands run and what they proved,",
  "5. what is still open or was explicitly left out.",
  "Keep exact identifiers: paths, symbols, commands, error strings.",
  "Do not invent progress that the conversation does not show. Output the summary only.",
].join("\n");

const COMPACT_REQUEST = "위 대화를 다음 작업에 필요한 만큼만 남도록 요약해라.";

export interface CompactInput {
  store: SessionStore;
  llm: LlmClient;
  apiKey: string | undefined;
  baseURL: string;
  model: string;
  /** Turns kept verbatim behind the summary. 0 summarizes everything. */
  keepRecentTurns: number;
  /** Extra instruction from `/compact <instruction>`. */
  instruction?: string;
  auto: boolean;
  signal?: AbortSignal;
}

export type CompactResult =
  | { ok: true; throughSeq: number; tokensBefore: number; summary: string }
  | { ok: false; reason: DeliveryReason | "nothing_to_compact" };

/**
 * Replaces the model history up to a turn boundary with one summary, as a
 * `context/compact` event. The log itself keeps every original event: the
 * summary changes what the model sees next turn, not what happened.
 */
export async function compactSession(
  sessionId: SessionId,
  input: CompactInput,
): Promise<CompactResult> {
  if (!input.apiKey || input.model.length === 0) {
    return { ok: false, reason: "missing_config" };
  }
  const events = input.store.events(sessionId);
  const throughSeq = compactBoundary(events, input.keepRecentTurns);
  if (throughSeq === null) {
    return { ok: false, reason: "nothing_to_compact" };
  }
  const before = events.filter((event) => event.seq <= throughSeq);
  const history = deriveMessages(before);
  if (history.length === 0) {
    return { ok: false, reason: "nothing_to_compact" };
  }
  const tokensBefore = historyTokens(history);
  const request = input.instruction?.trim()
    ? `${COMPACT_REQUEST}\n\n추가 지시: ${input.instruction.trim()}`
    : COMPACT_REQUEST;
  let summary = "";
  try {
    for await (const event of input.llm.stream({
      baseURL: input.baseURL,
      apiKey: input.apiKey,
      model: input.model,
      system: COMPACT_SYSTEM,
      messages: [...history, { role: "user", content: request }],
      ...(input.signal ? { signal: input.signal } : {}),
    })) {
      if (event.type === "text") {
        summary += event.text;
      }
    }
  } catch (err) {
    return { ok: false, reason: err instanceof LlmError ? err.reason : "unknown" };
  }
  const text = summary.trim();
  if (text.length === 0) {
    return { ok: false, reason: "unknown" };
  }
  input.store.append(sessionId, {
    type: "context/compact",
    throughSeq,
    summary: text,
    tokensBefore,
    auto: input.auto,
  });
  return { ok: true, throughSeq, tokensBefore, summary: text };
}
