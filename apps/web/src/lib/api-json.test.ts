import { describe, expect, test } from "bun:test";
import { parseApiBody } from "./api-json.ts";

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
});
