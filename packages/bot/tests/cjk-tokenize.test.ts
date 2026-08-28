import { describe, expect, test } from "bun:test";
import { cjkMatchQuery, cjkSearchText, cjkTokens } from "../src/cjk-tokenize.ts";

describe("cjkTokens", () => {
  test("splits a hangul run into overlapping bigrams", () => {
    expect(cjkTokens("세션로그")).toEqual(["세션", "션로", "로그"]);
  });

  test("keeps a two-character korean word as one token", () => {
    expect(cjkTokens("일본")).toEqual(["일본"]);
  });

  test("emits a lone cjk character as a unigram", () => {
    expect(cjkTokens("한")).toEqual(["한"]);
  });

  test("keeps latin words whole and lowercased", () => {
    expect(cjkTokens("Session Log")).toEqual(["session", "log"]);
  });

  test("mixes latin and hangul runs", () => {
    expect(cjkTokens("API 세션")).toEqual(["api", "세션"]);
  });
});

describe("cjk search strings", () => {
  test("joins tokens for unicode61 FTS", () => {
    expect(cjkSearchText("세션로그")).toBe("세션 션로 로그");
  });

  test("quotes tokens for MATCH", () => {
    expect(cjkMatchQuery("세션 로그")).toBe('"세션" OR "로그"');
    expect(cjkMatchQuery("   ")).toBeUndefined();
  });
});
