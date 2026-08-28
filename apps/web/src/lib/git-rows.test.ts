import { describe, expect, test } from "bun:test";
import { codeOf, groupFiles, isConflict, splitPath, toneOf } from "./git-rows.ts";
import type { GitFileView } from "./api.ts";

function file(index: string, worktree: string, path: string): GitFileView {
  return { index, worktree, path, label: "" };
}

describe("groupFiles", () => {
  test("splits the two porcelain columns", () => {
    const groups = groupFiles([
      file("M", " ", "staged.ts"),
      file(" ", "M", "dirty.ts"),
      file("?", "?", "new.ts"),
    ]);
    expect(groups.map((group) => [group.key, group.files.length])).toEqual([
      ["staged", 1],
      ["worktree", 1],
      ["untracked", 1],
    ]);
  });

  test("a file changed in both columns lands in both groups", () => {
    const groups = groupFiles([file("M", "M", "both.ts")]);
    expect(groups.map((group) => group.key)).toEqual(["staged", "worktree"]);
  });

  test("a conflict is its own group and never counted as staged", () => {
    for (const pair of ["UU", "AA", "DD", "AU", "UA", "DU", "UD"]) {
      const groups = groupFiles([file(pair[0] ?? "", pair[1] ?? "", "clash.ts")]);
      expect(groups.map((group) => group.key)).toEqual(["conflict"]);
    }
  });

  test("drops empty groups", () => {
    expect(groupFiles([])).toEqual([]);
  });
});

describe("splitPath", () => {
  test("keeps the basename and the directory apart", () => {
    expect(splitPath(file(" ", "M", "apps/web/src/App.tsx"))).toEqual({
      dir: "apps/web/src",
      base: "App.tsx",
    });
    expect(splitPath(file("?", "?", "notes.md"))).toEqual({ dir: "", base: "notes.md" });
  });

  test("a rename shows its new name", () => {
    expect(splitPath(file("R", " ", "old.md -> docs/new.md"))).toEqual({
      dir: "docs",
      base: "new.md",
    });
  });

  test("an arrow inside a plain filename is not a rename", () => {
    expect(splitPath(file(" ", "M", "docs/a -> b.md"))).toEqual({ dir: "docs", base: "a -> b.md" });
    expect(splitPath(file("?", "?", "untracked -> weird.md"))).toEqual({
      dir: "",
      base: "untracked -> weird.md",
    });
  });

  test("a rename splits at the first arrow, so the new name may hold one", () => {
    expect(splitPath(file("R", " ", "keep.md -> renamed -> here.md"))).toEqual({
      dir: "",
      base: "renamed -> here.md",
    });
  });

  test("an untracked directory loses its trailing slash", () => {
    expect(splitPath(file("?", "?", "example-project/"))).toEqual({
      dir: "",
      base: "example-project",
    });
  });
});

describe("codeOf and toneOf", () => {
  test("reads the column that owns the group", () => {
    const both = file("A", "M", "x.ts");
    expect(codeOf(both, "index")).toBe("A");
    expect(codeOf(both, "worktree")).toBe("M");
    expect(codeOf(file("M", " ", "x.ts"), "worktree")).toBe("·");
  });

  test("colours add, drop, and untracked apart", () => {
    expect(toneOf(file("A", " ", "x"), "index")).toBe("tone-add");
    expect(toneOf(file("D", " ", "x"), "index")).toBe("tone-drop");
    expect(toneOf(file("U", "U", "x"), "worktree")).toBe("tone-drop");
    expect(toneOf(file("?", "?", "x"), "worktree")).toBe("tone-new");
    expect(toneOf(file(" ", "M", "x"), "worktree")).toBe("");
  });
});

describe("isConflict", () => {
  test("does not flag an ordinary staged add", () => {
    expect(isConflict(file("A", " ", "x"))).toBe(false);
    expect(isConflict(file("A", "A", "x"))).toBe(true);
  });
});
