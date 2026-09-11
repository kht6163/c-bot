import { describe, expect, test } from "bun:test";
import { ApiError, parseApiBody } from "./api-json.ts";

describe("parseApiBody", () => {
  test("parses JSON", () => {
    expect(parseApiBody<{ path: string }>('{"path":"/tmp"}', 200, "/api/fs/resolve-dir")).toEqual({
      path: "/tmp",
    });
  });

  test("rejects HTML from the Vite SPA fallback", () => {
    expect(() => parseApiBody("<!doctype html><html></html>", 200, "/api/fs/resolve-dir")).toThrow(
      /listening/,
    );
  });

  test("surfaces API error messages", () => {
    expect(() => parseApiBody('{"error":"folder not found"}', 404, "/api/fs/resolve-dir")).toThrow(
      "folder not found",
    );
  });

  test("carries the status and the reason code of a refusal", () => {
    let caught: unknown;
    try {
      parseApiBody('{"error":"worktree has uncommitted changes","reason":"worktree_dirty"}', 409, "x");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(409);
    expect((caught as ApiError).reason).toBe("worktree_dirty");
  });
});
