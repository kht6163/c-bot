import { hasOpenTurn, type SessionId } from "@cbot/shared";
import type { SessionStore } from "@cbot/agent";

/**
 * The coding session whose sidebar row a log belongs to: the session itself,
 * or the parent of a specialist hop it summoned. Canonical bot chats have none.
 */
export function codingSessionOf(store: SessionStore, sessionId: SessionId): SessionId | undefined {
  const session = store.get(sessionId);
  if (!session) {
    return undefined;
  }
  if (session.kind === "coding") {
    return session.id;
  }
  const parent = session.parentId ? store.get(session.parentId) : undefined;
  return parent?.kind === "coding" ? parent.id : undefined;
}

/** True while the coding session or any specialist hop under it has an open turn. */
export function isCodingSessionRunning(store: SessionStore, codingId: SessionId): boolean {
  if (hasOpenTurn(store.events(codingId))) {
    return true;
  }
  return store.list({ parentId: codingId }).some((hop) => hasOpenTurn(store.events(hop.id)));
}

export function runningCodingSessions(store: SessionStore): SessionId[] {
  return store
    .list({ kind: "coding" })
    .filter((session) => isCodingSessionRunning(store, session.id))
    .map((session) => session.id);
}
