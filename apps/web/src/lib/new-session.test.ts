import { describe, expect, test } from "bun:test";
import { branchProblem, suggestBranch, worktreePreview } from "./new-session.ts";

const NOON = new Date(2026, 8, 11, 12, 5);

describe("suggestBranch", () => {
  test("turns the session name into a branch under cbot/", () => {
    expect(suggestBranch("Fix login bug!", [], NOON)).toBe("cbot/fix-login-bug");
    expect(suggestBranch("  Café  Menu ", [], NOON)).toBe("cbot/cafe-menu");
  });

  test("falls back to the time when the name has no ASCII to use", () => {
    expect(suggestBranch("", [], NOON)).toBe("cbot/0911-1205");
    expect(suggestBranch("로그인 버그", [], NOON)).toBe("cbot/0911-1205");
  });

  test("numbers the branch while the name is taken", () => {
    expect(suggestBranch("fix", ["cbot/fix", "cbot/fix-2"], NOON)).toBe("cbot/fix-3");
  });
});

describe("branchProblem", () => {
  test("accepts a free, well-formed branch", () => {
    expect(branchProblem("cbot/fix", ["main"])).toBeNull();
  });

  test("names what is wrong with the rest", () => {
    expect(branchProblem("  ", [])).toBe("브랜치 이름을 적어 주세요");
    expect(branchProblem("bad name", [])).toBe("브랜치 이름으로 쓸 수 없습니다");
    expect(branchProblem("main", ["main"])).toBe("이미 있는 브랜치입니다");
    expect(branchProblem("main/x", ["main"])).toBe("이미 있는 브랜치와 경로가 겹칩니다");
    expect(branchProblem("cbot", ["cbot/fix"])).toBe("이미 있는 브랜치와 경로가 겹칩니다");
  });
});

describe("worktreePreview", () => {
  test("puts the branch's last part under the repository's worktree folder", () => {
    expect(worktreePreview("/home/me/.c-bot/worktrees/app", "cbot/fix")).toBe(
      "/home/me/.c-bot/worktrees/app/fix",
    );
  });
});
