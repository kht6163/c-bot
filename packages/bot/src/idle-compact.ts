/**
 * Idle auto-compact may run only when the bot enabled it, the wall-clock idle
 * elapsed, and the derived history crossed `maxTokens * compactAt`.
 */
export function idleCompactReady(input: {
  enabled: boolean;
  idleMs: number;
  lastActivityMs: number;
  nowMs: number;
  tokens: number;
  maxTokens: number;
  compactAt: number;
}): boolean {
  if (!input.enabled || input.idleMs <= 0) {
    return false;
  }
  if (input.nowMs - input.lastActivityMs < input.idleMs) {
    return false;
  }
  if (input.tokens < input.maxTokens * input.compactAt) {
    return false;
  }
  return true;
}

export function lastActivityMs(
  events: readonly { time: string }[],
  fallbackMs: number,
): number {
  let max = 0;
  for (const event of events) {
    const t = Date.parse(event.time);
    if (Number.isFinite(t) && t > max) {
      max = t;
    }
  }
  return max > 0 ? max : fallbackMs;
}

export function maxEventSeq(events: readonly { seq: number }[]): number {
  let max = 0;
  for (const event of events) {
    if (event.seq > max) {
      max = event.seq;
    }
  }
  return max;
}
