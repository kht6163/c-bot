import { describe, expect, test } from "bun:test";
import { atTokens, findActiveAt } from "../src/at.ts";

describe("findActiveAt", () => {
  test("finds a query after @", () => {
    expect(findActiveAt("see @src/a", 10)).toEqual({ start: 4, end: 10, query: "src/a" });
    expect(findActiveAt("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  test("ignores email-style and closed tokens", () => {
    expect(findActiveAt("a@b.com", 7)).toBeNull();
    expect(findActiveAt("see @src foo", 12)).toBeNull();
  });
});

describe("atTokens", () => {
  test("collects @tokens after whitespace", () => {
    expect(atTokens("look at @src/a.ts and @leader")).toEqual(["src/a.ts", "leader"]);
    expect(atTokens("email me@x.com then @pkg/mod.ts")).toEqual(["pkg/mod.ts"]);
  });
});
