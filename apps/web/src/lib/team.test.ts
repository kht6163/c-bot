import { describe, expect, test } from "bun:test";
import { asSessionId, type SessionEvent, type SessionWorktree } from "@cbot/shared";
import {
  fallbackAfterDelete,
  mergeEventList,
  normalizeViewMode,
  specialistSessionIds,
  teamPanes,
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

describe("normalizeViewMode", () => {
  test("keeps agent and graph, and migrates legacy split to agent", () => {
    expect(normalizeViewMode("agent")).toBe("agent");
    expect(normalizeViewMode("graph")).toBe("graph");
    expect(normalizeViewMode("split")).toBe("agent");
    expect(normalizeViewMode(undefined)).toBe("agent");
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

  test("a deleted worktree session falls back to a session of the same project", () => {
    type Row = { id: string; workspace: string; worktree: SessionWorktree | null };
    const worktree = { project: "/a", branch: "cbot/fix", root: "/wt/a/fix", base: "0".repeat(40) };
    const remaining: Row[] = [
      { id: "b", workspace: "/b", worktree: null },
      { id: "a2", workspace: "/a", worktree: null },
    ];
    const deleted: Row = { id: "a1", workspace: "/wt/a/fix", worktree };
    expect(fallbackAfterDelete(deleted, "a1", remaining)?.id).toBe("a2");
  });
});

describe("specialistSessionIds", () => {
  test("skips the leader mailbox", () => {
    expect(
      specialistSessionIds([{ role: "specialist", sessionId: "ses_hop_r" }]),
    ).toEqual([asSessionId("ses_hop_r")]);
  });
});
