import type { SessionEvent, SessionId } from "@cbot/shared";

export type ViewMode = "agent" | "split";

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

export function equalWeights(count: number): number[] {
  if (count <= 0) {
    return [];
  }
  return Array.from({ length: count }, () => 1 / count);
}

export function dragSplit(weights: number[], index: number, delta: number, min = 0.16): number[] {
  const left = weights[index];
  const right = weights[index + 1];
  if (left === undefined || right === undefined) {
    return weights;
  }
  let shift = delta;
  if (left + shift < min) {
    shift = min - left;
  }
  if (right - shift < min) {
    shift = right - min;
  }
  const next = weights.slice();
  next[index] = left + shift;
  next[index + 1] = right - shift;
  return next;
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

export function fallbackAfterDelete<T extends { id: string; workspace: string | null }>(
  deleted: T,
  currentId: string | undefined,
  remaining: readonly T[],
): T | undefined {
  if (deleted.id !== currentId) {
    return remaining.find((session) => session.id === currentId);
  }
  return remaining.find((session) => session.workspace === deleted.workspace) ?? remaining[0];
}

export function specialistSessionIds(
  members: readonly { role: "leader" | "specialist"; sessionId: string }[],
): SessionId[] {
  return members
    .filter((member) => member.role === "specialist")
    .map((member) => member.sessionId as SessionId);
}
