import { describe, expect, test } from "bun:test";
import {
  SLASH_COMMANDS,
  filterSlashCommands,
  findActiveSlash,
  parseSlashCommand,
} from "../src/commands.ts";

describe("parseSlashCommand", () => {
  test("reads a known command with no arguments", () => {
    expect(parseSlashCommand("/help")).toEqual({ name: "help", args: "" });
  });

  test("keeps the rest of the line as arguments", () => {
    expect(parseSlashCommand("/compact 버그 원인만 남겨라")).toEqual({
      name: "compact",
      args: "버그 원인만 남겨라",
    });
  });

  test("an unknown command stays ordinary text", () => {
    expect(parseSlashCommand("/deploy now")).toBeNull();
  });

  test("a path is not a command", () => {
    expect(parseSlashCommand("/Users/me/app 을 봐줘")).toBeNull();
    expect(parseSlashCommand("/usr/local/bin 확인")).toBeNull();
  });

  test("a command must open the message", () => {
    expect(parseSlashCommand("이거 /help 참고")).toBeNull();
  });
});

describe("findActiveSlash", () => {
  test("tracks the command token being typed", () => {
    expect(findActiveSlash("/com", 4)).toEqual({ start: 0, end: 4, query: "com" });
  });

  test("closes once the argument starts", () => {
    expect(findActiveSlash("/compact 요약", 11)).toBeNull();
  });

  test("stays closed for text that only mentions a slash", () => {
    expect(findActiveSlash("경로 /tmp", 8)).toBeNull();
  });
});

describe("filterSlashCommands", () => {
  test("an empty query offers every command", () => {
    expect(filterSlashCommands("")).toHaveLength(SLASH_COMMANDS.length);
  });

  test("matches by name prefix", () => {
    expect(filterSlashCommands("cl").map((item) => item.name)).toEqual(["clear"]);
  });
});
