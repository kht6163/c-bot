/** Idle wait a bot gets when it turns idle auto-compact on without naming a time. */
export const DEFAULT_AUTO_COMPACT_IDLE_MS = 60_000;

/**
 * Bounds for the idle wait a user types per bot. The watcher only looks every
 * few seconds, so a shorter wait would promise a precision it cannot keep, and
 * a wait of `0` would read as "off" to `idleCompactReady` while the switch says on.
 */
export const AUTO_COMPACT_IDLE_MIN_MS = 5_000;
export const AUTO_COMPACT_IDLE_MAX_MS = 24 * 60 * 60 * 1_000;

/** Units the idle wait is typed in. */
export type IdleUnit = "sec" | "min" | "hour";

export const IDLE_UNIT_MS: Record<IdleUnit, number> = {
  sec: 1_000,
  min: 60_000,
  hour: 3_600_000,
};

export function isIdleUnit(raw: unknown): raw is IdleUnit {
  return raw === "sec" || raw === "min" || raw === "hour";
}

/** Any typed or stored wait as whole milliseconds inside the allowed range. */
export function clampAutoCompactIdleMs(ms: number): number {
  if (!Number.isFinite(ms)) {
    return DEFAULT_AUTO_COMPACT_IDLE_MS;
  }
  return Math.min(AUTO_COMPACT_IDLE_MAX_MS, Math.max(AUTO_COMPACT_IDLE_MIN_MS, Math.round(ms)));
}

/** The wait as a whole number in the largest unit it divides into, for an input to read back. */
export function autoCompactIdleParts(ms: number): { value: number; unit: IdleUnit } {
  const clamped = clampAutoCompactIdleMs(ms);
  if (clamped % IDLE_UNIT_MS.hour === 0) {
    return { value: clamped / IDLE_UNIT_MS.hour, unit: "hour" };
  }
  if (clamped % IDLE_UNIT_MS.min === 0) {
    return { value: clamped / IDLE_UNIT_MS.min, unit: "min" };
  }
  return { value: Math.round(clamped / IDLE_UNIT_MS.sec), unit: "sec" };
}

/** A typed count of one unit as a wait in range; a count below one unit is one unit. */
export function autoCompactIdleMsOf(value: number, unit: IdleUnit): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_AUTO_COMPACT_IDLE_MS;
  }
  return clampAutoCompactIdleMs(Math.max(1, Math.round(value)) * IDLE_UNIT_MS[unit]);
}
