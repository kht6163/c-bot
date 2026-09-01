import type { SessionEvent } from "@cbot/shared";
import type { ChatMessage } from "./session/derive.ts";

/** Per-message wire overhead (role, separators) the provider counts too. */
const MESSAGE_OVERHEAD = 4;

/**
 * Rough token count. No tokenizer is shipped, so this is deliberately an
 * estimate: CJK runs about one token per character, latin text about four
 * characters per token. Used for the compaction threshold and the UI gauge,
 * never for billing.
 */
export function estimateTokens(text: string): number {
  let wide = 0;
  let narrow = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (isWide(code)) {
      wide += 1;
    } else {
      narrow += 1;
    }
  }
  return Math.ceil(wide + narrow / 4);
}

export function historyTokens(messages: readonly ChatMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += MESSAGE_OVERHEAD + estimateTokens(message.content);
    for (const call of message.toolCalls ?? []) {
      total += estimateTokens(call.name) + estimateTokens(call.arguments);
    }
  }
  return total;
}

/**
 * The seq the model history may be replaced through, keeping the last
 * `keepRecentTurns` turns verbatim. Always a `turn/end`, so no assistant
 * message is ever cut away from the tool results that answer it.
 * Null when there is nothing behind that boundary worth summarizing.
 */
export function compactBoundary(
  events: readonly SessionEvent[],
  keepRecentTurns: number,
): number | null {
  const start = contextStart(events);
  const ends: number[] = [];
  for (const event of events) {
    if (event.seq > start && event.type === "turn/end") {
      ends.push(event.seq);
    }
  }
  const keep = Math.max(0, Math.trunc(keepRecentTurns));
  const boundary = ends[ends.length - 1 - keep];
  return boundary === undefined ? null : boundary;
}

/** Seq of the newest context boundary; 0 when the whole log is still history. */
export function contextStart(events: readonly SessionEvent[]): number {
  let start = 0;
  for (const event of events) {
    if (event.type === "context/clear") {
      start = event.seq;
    } else if (event.type === "context/compact") {
      start = event.throughSeq;
    }
  }
  return start;
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xa960 && code <= 0xa97f) ||
    (code >= 0xac00 && code <= 0xd7ff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3ffff)
  );
}
