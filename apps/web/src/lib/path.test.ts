import { describe, expect, test } from "bun:test";
import { folderName, projectPaths, timeAgo } from "./path.ts";

describe("folderName", () => {
  test("takes the last path segment", () => {
    expect(folderName("/Users/me/project/c-bot")).toBe("c-bot");
    expect(folderName("C:\\Users\\me\\demo")).toBe("demo");
  });
});

describe("projectPaths", () => {
  test("puts current first and keeps other recents", () => {
    expect(projectPaths({ current: "/a", recents: ["/b", "/a"] })).toEqual(["/a", "/b"]);
    expect(projectPaths({ current: "/a", recents: ["/b"] })).toEqual(["/a", "/b"]);
    expect(projectPaths({ current: "/a", recents: [] })).toEqual(["/a"]);
    expect(projectPaths({ current: null, recents: ["/b"] })).toEqual(["/b"]);
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
