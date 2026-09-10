import type { NoteStorage } from "./team.ts";

export const INSPECTOR_MIN_W = 240;
export const INSPECTOR_MAX_W = 720;
export const INSPECTOR_DEFAULT_W = 300;

/** The chat keeps this much room, so dragging can never squeeze it away. */
const MAIN_MIN_W = 380;
const RAIL_W = 260;
const STORAGE_KEY = "cbot.inspector.width";
const TAB_KEY = "cbot.inspector.tab";

export type InspectorTab = "git" | "files" | "tasks";
export const INSPECTOR_DEFAULT_TAB: InspectorTab = "git";

export function clampInspectorWidth(px: number, viewport: number): number {
  const room = viewport - RAIL_W - MAIN_MIN_W;
  const max = Math.max(INSPECTOR_MIN_W, Math.min(INSPECTOR_MAX_W, room));
  return Math.round(Math.min(max, Math.max(INSPECTOR_MIN_W, px)));
}

/** The pane hugs the right edge, so its width is what is left of the pointer. */
export function widthFromPointer(clientX: number, viewport: number): number {
  return clampInspectorWidth(viewport - clientX, viewport);
}

export function loadInspectorWidth(storage: NoteStorage, viewport: number): number {
  try {
    const raw = Number(storage.getItem(STORAGE_KEY));
    return raw > 0 ? clampInspectorWidth(raw, viewport) : INSPECTOR_DEFAULT_W;
  } catch {
    // private mode: the default width is answer enough
    return INSPECTOR_DEFAULT_W;
  }
}

export function saveInspectorWidth(px: number, storage: NoteStorage): void {
  try {
    storage.setItem(STORAGE_KEY, String(px));
  } catch {
    // quota / private mode
  }
}

/** The open tab outlives session switches and reloads; an unknown value falls back to Git. */
export function loadInspectorTab(storage: NoteStorage): InspectorTab {
  try {
    const raw = storage.getItem(TAB_KEY);
    return raw === "git" || raw === "files" || raw === "tasks" ? raw : INSPECTOR_DEFAULT_TAB;
  } catch {
    // private mode: Git is the default tab anyway
    return INSPECTOR_DEFAULT_TAB;
  }
}

export function saveInspectorTab(tab: InspectorTab, storage: NoteStorage): void {
  try {
    storage.setItem(TAB_KEY, tab);
  } catch {
    // quota / private mode
  }
}
