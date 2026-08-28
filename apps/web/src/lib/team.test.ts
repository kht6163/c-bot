import { describe, expect, test } from "bun:test";
import { asSessionId, type SessionEvent } from "@cbot/shared";
import {
  cascadeNote,
  clampNote,
  fallbackAfterDelete,
  loadNoteLayout,
  mergeEventList,
  mergeNotes,
  mergeOrder,
  moveNote,
  noteExtent,
  parseNoteLayout,
  raiseNote,
  resizeNote,
  saveNoteLayout,
  serializeNoteLayout,
  specialistSessionIds,
  teamPanes,
  toggleCollapsed,
  visibleNote,
  wheelResize,
  type NoteStorage,
} from "./team.ts";

describe("teamPanes", () => {
  test("puts the coding session first and specialists after", () => {
    const panes = teamPanes("ses_code", [
      {
        id: "bot_r",
        handle: "researcher",
        title: "Researcher",
        role: "specialist",
        sessionId: "ses_hop_r",
      },
    ]);
    expect(panes.map((pane) => pane.key)).toEqual(["lead", "bot_r"]);
    expect(panes[0]?.sessionId).toBe("ses_code");
    expect(panes[1]?.sessionId).toBe("ses_hop_r");
  });

  test("a coding session with no hops is lead-only", () => {
    expect(teamPanes("ses_code", []).map((pane) => pane.key)).toEqual(["lead"]);
  });
});

describe("note layout", () => {
  test("places new notes in a loose two-column stack", () => {
    expect(cascadeNote(0)).toEqual({ x: 16, y: 16, w: 420, h: 320, collapsed: false });
    expect(cascadeNote(1)).toEqual({ x: 452, y: 16, w: 420, h: 320, collapsed: false });
    expect(cascadeNote(2)).toEqual({ x: 16, y: 352, w: 420, h: 320, collapsed: false });
  });

  test("keeps a floor on size and origin", () => {
    const clamped = clampNote({ x: -20, y: -4, w: 10, h: 10, collapsed: false });
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(0);
    expect(clamped.w).toBeGreaterThanOrEqual(280);
    expect(clamped.h).toBeGreaterThanOrEqual(160);
  });

  test("collapsed notes keep stored height but show only the title bar", () => {
    const note = { x: 10, y: 10, w: 400, h: 320, collapsed: true };
    expect(visibleNote(note)).toEqual({ x: 10, y: 10, w: 400, h: 32 });
    expect(toggleCollapsed(note).collapsed).toBe(false);
    expect(toggleCollapsed(note).h).toBe(320);
  });

  test("wheel up grows height, shift grows width, and a collapsed note can reopen", () => {
    const note = { x: 0, y: 0, w: 400, h: 300, collapsed: false };
    expect(wheelResize(note, -40).h).toBe(340);
    expect(wheelResize(note, 40).h).toBe(260);
    expect(wheelResize(note, -40, true).w).toBe(440);
    const shut = { ...note, collapsed: true };
    expect(wheelResize(shut, 40).collapsed).toBe(true);
    expect(wheelResize(shut, -40).collapsed).toBe(false);
  });

  test("move and resize stay on the board", () => {
    const note = cascadeNote(0);
    expect(moveNote(note, 12, 8)).toMatchObject({ x: 28, y: 24 });
    expect(resizeNote(note, 20, 30, "se")).toMatchObject({ w: 440, h: 350 });
    expect(resizeNote(note, 20, 30, "e").h).toBe(320);
  });

  test("merges saved notes with new keys and drops gone ones", () => {
    const saved = { lead: { x: 40, y: 50, w: 500, h: 360, collapsed: true } };
    const merged = mergeNotes(["lead", "bot_r"], saved);
    expect(merged.lead).toEqual(saved.lead);
    expect(merged.bot_r).toEqual(cascadeNote(1));
    expect(mergeOrder(["bot_r", "gone", "lead"], ["lead", "bot_r"])).toEqual(["bot_r", "lead"]);
    expect(raiseNote(["lead", "bot_r"], "lead")).toEqual(["bot_r", "lead"]);
  });

  test("extent follows the farthest visible corner", () => {
    expect(
      noteExtent(
        [
          { x: 0, y: 0, w: 100, h: 100, collapsed: false },
          { x: 200, y: 50, w: 80, h: 40, collapsed: true },
        ],
        24,
      ),
    ).toEqual({ w: 304, h: 124 });
  });

  test("round-trips through storage and ignores junk", () => {
    const map = new Map<string, string>();
    const storage: NoteStorage = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value);
      },
    };
    const layout = {
      order: ["lead"],
      notes: { lead: { x: 8, y: 9, w: 300, h: 220, collapsed: true } },
    };
    saveNoteLayout("ses_1", layout, storage);
    expect(loadNoteLayout("ses_1", storage)).toEqual(layout);
    expect(parseNoteLayout("not-json")).toEqual({ order: [], notes: {} });
    expect(parseNoteLayout(serializeNoteLayout(layout)).notes.lead?.collapsed).toBe(true);
  });
});

describe("mergeEventList", () => {
  test("inserts by seq and ignores duplicates", () => {
    const first = {
      seq: 1,
      time: "t",
      type: "user/message",
      text: "a",
      mentions: [],
    } as SessionEvent;
    const second = {
      seq: 2,
      time: "t",
      type: "user/message",
      text: "b",
      mentions: [],
    } as SessionEvent;
    const merged = mergeEventList([second], first);
    expect(merged.map((event) => event.seq)).toEqual([1, 2]);
    expect(mergeEventList(merged, first)).toEqual(merged);
  });
});

describe("fallbackAfterDelete", () => {
  test("stays on the open session when another row is deleted", () => {
    const remaining = [
      { id: "keep", workspace: "/a" },
      { id: "other", workspace: "/b" },
    ];
    expect(fallbackAfterDelete({ id: "gone", workspace: "/a" }, "keep", remaining)?.id).toBe(
      "keep",
    );
  });

  test("prefers a sibling workspace after deleting the open session", () => {
    const remaining = [
      { id: "b", workspace: "/b" },
      { id: "a2", workspace: "/a" },
    ];
    expect(fallbackAfterDelete({ id: "a1", workspace: "/a" }, "a1", remaining)?.id).toBe("a2");
  });
});

describe("specialistSessionIds", () => {
  test("skips the leader mailbox", () => {
    expect(
      specialistSessionIds([{ role: "specialist", sessionId: "ses_hop_r" }]),
    ).toEqual([asSessionId("ses_hop_r")]);
  });
});
