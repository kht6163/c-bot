import { DEFAULT_AUTO_COMPACT_IDLE_MS } from "./types.ts";

/** UI / profile presets for per-bot idle auto-compact. `"off"` is the default. */
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
    return { autoCompactIdle: false, autoCompactIdleMs: DEFAULT_AUTO_COMPACT_IDLE_MS };
  }
  const ms = AUTO_COMPACT_IDLE_PRESETS.find((item) => item.id === preset)?.ms ?? DEFAULT_AUTO_COMPACT_IDLE_MS;
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
