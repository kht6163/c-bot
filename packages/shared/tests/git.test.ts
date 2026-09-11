import { describe, expect, test } from "bun:test";
import { isBranchName, worktreeFolderName } from "../src/git.ts";

const NAMES = [
  "main",
  "cbot/fix-login",
  "feature/a/b",
  "cbot/로그인",
  "v1.2",
  "a-b_c",
  "",
  "-leading-dash",
  "has space",
  "double..dot",
  "trailing.",
  "trailing/",
  "/leading",
  "a//b",
  ".hidden",
  "a/.hidden",
  "name.lock",
  "a/b.lock/c",
  "at@{brace",
  "@",
  "HEAD",
  "tilde~1",
  "caret^",
  "colon:x",
  "question?",
  "star*",
  "open[bracket",
  "back\\slash",
  "tab\tname",
];

describe("isBranchName", () => {
  test("agrees with git check-ref-format --branch", () => {
    for (const name of NAMES) {
      const git = Bun.spawnSync(["git", "check-ref-format", "--branch", name]);
      expect({ name, ok: isBranchName(name) }).toEqual({ name, ok: git.exitCode === 0 });
    }
  });
});

describe("worktreeFolderName", () => {
  test("names the folder after the last part of the branch", () => {
    expect(worktreeFolderName("cbot/fix-login")).toBe("fix-login");
    expect(worktreeFolderName("main")).toBe("main");
    expect(worktreeFolderName("feature/a/b")).toBe("b");
  });
});
