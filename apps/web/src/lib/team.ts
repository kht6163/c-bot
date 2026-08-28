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

export interface NoteRect {
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed: boolean;
}

export interface NoteLayout {
  order: string[];
  notes: Record<string, NoteRect>;
}

export interface NoteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const NOTE_HEAD = 32;
export const NOTE_MIN_W = 280;
export const NOTE_MIN_H = 160;
export const NOTE_MAX_W = 1200;
export const NOTE_MAX_H = 1600;

export function noteStorageKey(sessionId: string): string {
  return `cbot.notes.v2.${sessionId}`;
}

export function cascadeNote(index: number): NoteRect {
  const col = index % 2;
  const row = Math.floor(index / 2);
  return {
    x: 16 + col * 436,
    y: 16 + row * 336,
    w: 420,
    h: 320,
    collapsed: false,
  };
}

export function clampNote(note: NoteRect): NoteRect {
  return {
    x: Math.max(0, Math.round(note.x)),
    y: Math.max(0, Math.round(note.y)),
    w: Math.min(NOTE_MAX_W, Math.max(NOTE_MIN_W, Math.round(note.w))),
    h: Math.min(NOTE_MAX_H, Math.max(NOTE_MIN_H, Math.round(note.h))),
    collapsed: Boolean(note.collapsed),
  };
}

export function visibleNote(note: NoteRect): { x: number; y: number; w: number; h: number } {
  return {
    x: note.x,
    y: note.y,
    w: note.w,
    h: note.collapsed ? NOTE_HEAD : note.h,
  };
}

export function wheelResize(note: NoteRect, deltaY: number, shift = false): NoteRect {
  const step = Math.max(-96, Math.min(96, -deltaY));
  if (note.collapsed) {
    if (step <= 0) {
      return note;
    }
    return clampNote({ ...note, collapsed: false, h: Math.max(NOTE_MIN_H, note.h + step) });
  }
  if (shift) {
    return clampNote({ ...note, w: note.w + step });
  }
  return clampNote({ ...note, h: note.h + step });
}

export function moveNote(note: NoteRect, dx: number, dy: number): NoteRect {
  return clampNote({ ...note, x: note.x + dx, y: note.y + dy });
}

export function resizeNote(
  note: NoteRect,
  dx: number,
  dy: number,
  edges: "e" | "s" | "se",
): NoteRect {
  const next = { ...note };
  if (edges === "e" || edges === "se") {
    next.w = note.w + dx;
  }
  if (edges === "s" || edges === "se") {
    next.h = note.h + dy;
  }
  return clampNote(next);
}

export function toggleCollapsed(note: NoteRect): NoteRect {
  return { ...note, collapsed: !note.collapsed };
}

export function noteExtent(notes: Iterable<NoteRect>, pad = 24): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const note of notes) {
    const box = visibleNote(note);
    w = Math.max(w, box.x + box.w);
    h = Math.max(h, box.y + box.h);
  }
  return { w: w + pad, h: h + pad };
}

export function mergeNotes(keys: readonly string[], saved: Record<string, NoteRect>): Record<string, NoteRect> {
  const next: Record<string, NoteRect> = {};
  keys.forEach((key, index) => {
    const prev = saved[key];
    next[key] = prev ? clampNote(prev) : cascadeNote(index);
  });
  return next;
}

export function mergeOrder(saved: readonly string[], keys: readonly string[]): string[] {
  const want = new Set(keys);
  const kept = saved.filter((key) => want.has(key));
  const extra = keys.filter((key) => !kept.includes(key));
  return [...kept, ...extra];
}

export function raiseNote(order: readonly string[], key: string): string[] {
  if (!order.includes(key)) {
    return [...order, key];
  }
  return [...order.filter((item) => item !== key), key];
}

function asNote(value: unknown): NoteRect | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const rec = value as Record<string, unknown>;
  if (![rec.x, rec.y, rec.w, rec.h].every((item) => typeof item === "number" && Number.isFinite(item))) {
    return undefined;
  }
  return clampNote({
    x: rec.x as number,
    y: rec.y as number,
    w: rec.w as number,
    h: rec.h as number,
    collapsed: rec.collapsed === true,
  });
}

export function parseNoteLayout(raw: string | null): NoteLayout {
  if (!raw) {
    return { order: [], notes: {} };
  }
  try {
    const data = JSON.parse(raw) as { order?: unknown; notes?: unknown };
    const notes: Record<string, NoteRect> = {};
    if (data.notes && typeof data.notes === "object") {
      for (const [key, value] of Object.entries(data.notes as Record<string, unknown>)) {
        const note = asNote(value);
        if (note) {
          notes[key] = note;
        }
      }
    }
    const order = Array.isArray(data.order)
      ? data.order.filter((item): item is string => typeof item === "string" && item in notes)
      : Object.keys(notes);
    return { order, notes };
  } catch {
    return { order: [], notes: {} };
  }
}

export function serializeNoteLayout(layout: NoteLayout): string {
  return JSON.stringify({ v: 1, order: layout.order, notes: layout.notes });
}

export function loadNoteLayout(sessionId: string, storage: NoteStorage): NoteLayout {
  try {
    return parseNoteLayout(storage.getItem(noteStorageKey(sessionId)));
  } catch {
    return { order: [], notes: {} };
  }
}

export function saveNoteLayout(sessionId: string, layout: NoteLayout, storage: NoteStorage): void {
  try {
    storage.setItem(noteStorageKey(sessionId), serializeNoteLayout(layout));
  } catch {
    // quota / private mode
  }
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
