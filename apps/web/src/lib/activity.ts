import type { SessionId } from "@cbot/shared";

/**
 * What the sidebar dot says about a session the user is not looking at:
 * `running` blinks while a turn is open, `done` stays lit until the user
 * opens the session. Sessions without an entry show nothing.
 */
export type SessionActivity = "running" | "done";

export type ActivityMap = Readonly<Record<string, SessionActivity>>;

/** The list request tells which sessions are mid-turn right now. */
export function seedActivity(current: ActivityMap, running: readonly SessionId[]): ActivityMap {
  const next: Record<string, SessionActivity> = { ...current };
  for (const id of running) {
    next[id] = "running";
  }
  return next;
}

/**
 * Applies a `session/activity` frame. A turn ending in the session the user
 * has open leaves no mark: they watched it finish.
 */
export function applyActivity(
  current: ActivityMap,
  sessionId: SessionId,
  running: boolean,
  selectedId: SessionId | undefined,
): ActivityMap {
  if (running) {
    return current[sessionId] === "running" ? current : { ...current, [sessionId]: "running" };
  }
  if (sessionId === selectedId) {
    return clearActivity(current, sessionId);
  }
  return current[sessionId] === "done" ? current : { ...current, [sessionId]: "done" };
}

/**
 * The one mark a closed drawer shows for the rows it hides: `done` as soon as
 * any listed session other than the open one has finished, else `running`
 * while one works. Marks of sessions the sidebar does not list do not count.
 */
export function hiddenActivity(
  current: ActivityMap,
  listed: readonly SessionId[],
  selectedId: SessionId | undefined,
): SessionActivity | undefined {
  let running = false;
  for (const id of listed) {
    if (id === selectedId) {
      continue;
    }
    if (current[id] === "done") {
      return "done";
    }
    running ||= current[id] === "running";
  }
  return running ? "running" : undefined;
}

/** Opening or deleting a session takes its mark off the sidebar. */
export function clearActivity(current: ActivityMap, sessionId: SessionId): ActivityMap {
  if (!(sessionId in current)) {
    return current;
  }
  const next: Record<string, SessionActivity> = { ...current };
  delete next[sessionId];
  return next;
}
