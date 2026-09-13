import { sessionProject, type SessionEvent, type SessionId, type SessionWorktree } from "@cbot/shared";

export type ViewMode = "agent" | "graph";

/** Map a stored or legacy value onto a live view mode (`"split"` → `"agent"`). */
export function normalizeViewMode(raw: unknown): ViewMode {
  return raw === "graph" ? "graph" : "agent";
}

export interface TeamPane {
  key: string;
  handle: string;
  title: string;
  role: "lead" | "specialist";
  sessionId: string;
}

export function teamPanes(
  codingSessionId: string,
  members: readonly {
    id: string;
    handle: string;
    title: string;
    role: "leader" | "specialist";
    sessionId: string;
  }[],
  leadHandle = "leader",
  leadTitle = "Lead",
): TeamPane[] {
  const panes: TeamPane[] = [
    {
      key: "lead",
      handle: leadHandle,
      title: leadTitle,
      role: "lead",
      sessionId: codingSessionId,
    },
  ];
  for (const member of members) {
    if (member.role !== "specialist") {
      continue;
    }
    panes.push({
      key: member.id,
      handle: member.handle,
      title: member.title,
      role: "specialist",
      sessionId: member.sessionId,
    });
  }
  return panes;
}

export interface NoteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function mergeEventList(
  current: readonly SessionEvent[],
  event: SessionEvent,
): SessionEvent[] {
  if (current.some((item) => item.seq === event.seq)) {
    return [...current];
  }
  return [...current, event].sort((a, b) => a.seq - b.seq);
}

export function fallbackAfterDelete<
  T extends { id: string; workspace: string | null; worktree?: SessionWorktree | null },
>(deleted: T, currentId: string | undefined, remaining: readonly T[]): T | undefined {
  if (deleted.id !== currentId) {
    return remaining.find((session) => session.id === currentId);
  }
  const project = sessionProject(deleted);
  return remaining.find((session) => sessionProject(session) === project) ?? remaining[0];
}

export function specialistSessionIds(
  members: readonly { role: "leader" | "specialist"; sessionId: string }[],
): SessionId[] {
  return members
    .filter((member) => member.role === "specialist")
    .map((member) => member.sessionId as SessionId);
}
