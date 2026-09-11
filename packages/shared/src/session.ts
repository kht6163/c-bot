import type { SessionWorktree } from "./protocol.ts";

/** The name a coding session has until the user names it or its first message does. */
export const UNTITLED_SESSION = "새 세션";

/** Longest session name the server keeps. */
export const SESSION_TITLE_MAX = 80;

/** A session name is one line: every run of whitespace folds to a single space. */
export function normalizeSessionTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The project a coding session is filed under: a worktree session belongs to the folder it came from. */
export function sessionProject(session: {
  workspace: string | null;
  worktree?: SessionWorktree | null;
}): string | null {
  return session.worktree?.project ?? session.workspace;
}
