/** Backoff for the session websocket. A dev restart is back in a few hundred
 *  milliseconds, so the first retry is short; the cap keeps a stopped server
 *  from being hammered. `attempt` is 1-based. */
export const RECONNECT_BASE_MS = 400;
export const RECONNECT_MAX_MS = 5000;

export function reconnectDelay(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (n - 1));
}
