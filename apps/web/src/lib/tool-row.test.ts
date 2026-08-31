import { describe, expect, test } from "bun:test";
import { toolBody, toolHeadline, toolMark } from "./tool-row.ts";

describe("toolHeadline", () => {
  test("prefers the argument that says what the call touched", () => {
    expect(toolHeadline('{"path":"apps/web/src/styles.css","offset":1,"limit":40}')).toBe(
      "apps/web/src/styles.css",
    );
    expect(toolHeadline('{"pattern":"--bg-raised","path":"apps/web"}')).toBe("--bg-raised");
    expect(toolHeadline('{"command":"bun test apps/web"}')).toBe("bun test apps/web");
    expect(toolHeadline('{"target":"reviewer","message":"토큰을 봐 주세요"}')).toBe("reviewer");
  });

  test("falls back to the first string when no known key is present", () => {
    expect(toolHeadline('{"note":"자유 형식"}')).toBe("자유 형식");
  });

  test("collapses whitespace so a multi-line argument stays one line", () => {
    expect(toolHeadline('{"command":"bun run build \\n  && bun test"}')).toBe(
      "bun run build && bun test",
    );
  });

  test("truncates a long argument instead of pushing the row wide", () => {
    const headline = toolHeadline(JSON.stringify({ command: "x".repeat(400) }));
    expect(headline.length).toBe(140);
    expect(headline.endsWith("…")).toBe(true);
  });

  test("says nothing about a call whose JSON has not finished streaming", () => {
    expect(toolHeadline('{"path":"apps/web/src/sty')).toBe("");
    expect(toolHeadline("")).toBe("");
  });

  test("says nothing when no argument is a usable string", () => {
    expect(toolHeadline('{"todos":[{"title":"토큰 정리"}]}')).toBe("");
    expect(toolHeadline('{"replace_all":true}')).toBe("");
  });
});

describe("toolBody", () => {
  test("shows the result once it lands", () => {
    expect(toolBody('{"path":"README.md"}', "# c-bot")).toBe("# c-bot");
  });

  test("stays empty while running, since the head line already says what runs", () => {
    expect(toolBody('{"command":"bun test"}', "")).toBe("");
  });

  test("shows the raw call when no headline could be read", () => {
    expect(toolBody('{"todos":[]}', "")).toBe('{"todos":[]}');
  });
});

describe("toolMark", () => {
  test("waiting for approval outranks the call still being open", () => {
    expect(toolMark({ live: true, ok: true, pendingApproval: true })).toBe("waiting");
  });

  test("separates running, done and failed", () => {
    expect(toolMark({ live: true, ok: true, pendingApproval: false })).toBe("running");
    expect(toolMark({ live: false, ok: true, pendingApproval: false })).toBe("ok");
    expect(toolMark({ live: false, ok: false, pendingApproval: false })).toBe("failed");
  });
});
