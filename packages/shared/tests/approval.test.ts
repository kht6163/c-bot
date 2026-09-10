import { describe, expect, test } from "bun:test";
import { commandPrefix, isCommandAllowed, normalizeRule } from "../src/approval.ts";

describe("commandPrefix", () => {
  test("keeps the subcommand for runners and only the program otherwise", () => {
    expect(commandPrefix("bun test packages/agent")).toBe("bun test");
    expect(commandPrefix("git status --short")).toBe("git status");
    expect(commandPrefix("ls -la src")).toBe("ls");
    expect(commandPrefix("  cat   README.md")).toBe("cat");
  });

  test("does not treat a flag as a subcommand", () => {
    expect(commandPrefix("bun --version")).toBe("bun");
  });

  test("looks at the first segment of a compound command", () => {
    expect(commandPrefix("bun run typecheck && bun test")).toBe("bun run");
  });

  test("is empty for a blank command", () => {
    expect(commandPrefix("   ")).toBe("");
  });
});

describe("isCommandAllowed", () => {
  test("matches whole words at the start of the command", () => {
    expect(isCommandAllowed("bun test packages/agent", ["bun test"])).toBe(true);
    expect(isCommandAllowed("bun test", ["bun test"])).toBe(true);
    expect(isCommandAllowed("bun testing", ["bun test"])).toBe(false);
    expect(isCommandAllowed("git status", ["git"])).toBe(true);
  });

  test("every segment of a compound command must match a rule", () => {
    expect(isCommandAllowed("git status && git diff", ["git status", "git diff"])).toBe(true);
    expect(isCommandAllowed("git status && rm -rf /", ["git status"])).toBe(false);
    expect(isCommandAllowed("git status; curl x", ["git status"])).toBe(false);
    expect(isCommandAllowed("git log | head", ["git log", "head"])).toBe(true);
    expect(isCommandAllowed("git log || true", ["git log"])).toBe(false);
  });

  test("substitution and redirection never match", () => {
    expect(isCommandAllowed("git status $(rm x)", ["git status"])).toBe(false);
    expect(isCommandAllowed("git status `rm x`", ["git status"])).toBe(false);
    expect(isCommandAllowed("git status > ~/.zshrc", ["git status"])).toBe(false);
    expect(isCommandAllowed("cat < file", ["cat"])).toBe(false);
  });

  test("no rules or a blank command means not allowed", () => {
    expect(isCommandAllowed("ls", [])).toBe(false);
    expect(isCommandAllowed("", ["ls"])).toBe(false);
  });
});

describe("normalizeRule", () => {
  test("collapses whitespace", () => {
    expect(normalizeRule("  bun   test ")).toBe("bun test");
  });
});
