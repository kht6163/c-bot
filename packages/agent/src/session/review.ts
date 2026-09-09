import { isAbsolute, relative, resolve, sep } from "node:path";
import type { LoggedToolCall, SessionId } from "@cbot/shared";
import type { SessionStore } from "./store.ts";

export interface SessionReview {
  files: { path: string; writes: number; edits: number }[];
  shellCommands: number;
}

/** Tool activity is evidence of writes, not a baseline or a net Git diff. */
export function sessionReview(store: SessionStore, id: SessionId): SessionReview {
  const requested = store.get(id);
  const root = requested?.parentId ? store.get(requested.parentId) : requested;
  const files = new Map<string, SessionReview["files"][number]>();
  let shellCommands = 0;
  if (!root || root.kind !== "coding") {
    return { files: [], shellCommands };
  }
  const sessions = [root, ...store.list({ parentId: root.id })];
  for (const session of sessions) {
    const calls = new Map<string, LoggedToolCall>();
    const completed = new Set<string>();
    for (const event of store.events(session.id)) {
      if (event.type === "tool/call") {
        calls.set(`${event.turnId}:${event.call.id}`, event.call);
        continue;
      }
      if (event.type !== "tool/result" || event.pendingApproval) {
        continue;
      }
      const key = `${event.turnId}:${event.callId}`;
      const call = calls.get(key);
      if (!call || completed.has(key)) {
        continue;
      }
      completed.add(key);
      if (!event.ok) {
        continue;
      }
      if (call.name === "bash") {
        shellCommands += 1;
        continue;
      }
      if (call.name !== "write_file" && call.name !== "edit_file") {
        continue;
      }
      const path = reviewedPath(call.arguments, session.workspace ?? root.workspace, root.workspace);
      if (path === null) {
        continue;
      }
      const file = files.get(path) ?? { path, writes: 0, edits: 0 };
      if (call.name === "write_file") {
        file.writes += 1;
      } else {
        file.edits += 1;
      }
      files.set(path, file);
    }
  }
  return { files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), shellCommands };
}

function reviewedPath(args: string, workspace: string | null, root: string | null): string | null {
  if (!workspace || !root) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    // Historical or interrupted tool arguments may not contain complete JSON.
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("path" in parsed)) {
    return null;
  }
  const path = parsed.path;
  if (typeof path !== "string" || path.length === 0 || path.includes("\0")) {
    return null;
  }
  const absolute = resolve(workspace, path);
  const local = relative(workspace, absolute);
  const review = relative(root, absolute);
  if (![local, review].every((value) => value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value))) {
    return null;
  }
  return review.split(sep).join("/");
}
