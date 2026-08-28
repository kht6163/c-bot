import { describe, expect, test } from "bun:test";
import { folderName, projectPaths, projectTree, timeAgo } from "./path.ts";

describe("folderName", () => {
  test("takes the last path segment", () => {
    expect(folderName("/Users/me/project/c-bot")).toBe("c-bot");
    expect(folderName("C:\\Users\\me\\demo")).toBe("demo");
  });
});

describe("projectPaths", () => {
  test("keeps recents in added order and does not pin current first", () => {
    expect(projectPaths({ current: "/a", recents: ["/b", "/a"] })).toEqual(["/b", "/a"]);
    expect(projectPaths({ current: "/a", recents: ["/b"] })).toEqual(["/b", "/a"]);
    expect(projectPaths({ current: "/a", recents: [] })).toEqual(["/a"]);
    expect(projectPaths({ current: null, recents: ["/b"] })).toEqual(["/b"]);
  });
});

describe("projectTree", () => {
  test("groups sessions under recents in added order, then other workspaces", () => {
    const tree = projectTree(
      { current: "/a", recents: ["/b", "/a"] },
      [
        { workspace: "/c", updatedAt: "2026-08-27T12:00:00Z", title: "c-new" },
        { workspace: "/a", updatedAt: "2026-08-27T10:00:00Z", title: "a-old" },
        { workspace: "/a", updatedAt: "2026-08-27T11:00:00Z", title: "a-new" },
        { workspace: "/c", updatedAt: "2026-08-27T09:00:00Z", title: "c-old" },
        { workspace: null, updatedAt: "2026-08-27T13:00:00Z", title: "orphan" },
      ],
    );
    expect(tree.map((branch) => ({ path: branch.path, name: branch.name }))).toEqual([
      { path: "/b", name: "b" },
      { path: "/a", name: "a" },
      { path: "/c", name: "c" },
    ]);
    expect(tree[0]?.sessions).toEqual([]);
    expect(tree[1]?.sessions.map((session) => session.title)).toEqual(["a-new", "a-old"]);
    expect(tree[2]?.sessions.map((session) => session.title)).toEqual(["c-new", "c-old"]);
  });

  test("allows empty recents and still unions session workspaces", () => {
    const tree = projectTree({ current: "/a", recents: [] }, [
      { workspace: "/z", updatedAt: "2026-08-27T12:00:00Z", title: "other" },
      { workspace: "/a", updatedAt: "2026-08-27T11:00:00Z", title: "here" },
    ]);
    expect(tree.map((branch) => branch.path)).toEqual(["/a", "/z"]);
    expect(tree[0]?.sessions.map((session) => session.title)).toEqual(["here"]);
    expect(tree[1]?.sessions.map((session) => session.title)).toEqual(["other"]);
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-08-27T12:00:00Z");

  test("buckets recent times", () => {
    expect(timeAgo("2026-08-27T11:59:30Z", now)).toBe("방금");
    expect(timeAgo("2026-08-27T11:40:00Z", now)).toBe("20분");
    expect(timeAgo("2026-08-27T09:00:00Z", now)).toBe("3시간");
    expect(timeAgo("2026-08-25T12:00:00Z", now)).toBe("2일");
  });
});
