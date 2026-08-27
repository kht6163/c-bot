import { describe, expect, test } from "bun:test";
import { handleHttp } from "../src/http.ts";
import { loadProcessEnv } from "../src/env.ts";

describe("health", () => {
  test("GET /api/health returns ok", async () => {
    const res = await handleHttp(new Request("http://127.0.0.1/api/health"), {
      web: "none",
      distDir: "/tmp",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; name: string; version: number };
    expect(body.ok).toBe(true);
    expect(body.name).toBe("c-bot");
    expect(body.version).toBe(0);
  });

  test("unknown /api path without runtime is 503", async () => {
    const res = await handleHttp(new Request("http://127.0.0.1/api/missing"), {
      web: "none",
      distDir: "/tmp",
    });
    expect(res.status).toBe(503);
  });
});

describe("loadProcessEnv", () => {
  test("defaults host, port, and home", () => {
    const env = loadProcessEnv({});
    expect(env.host).toBe("127.0.0.1");
    expect(env.port).toBe(3080);
    expect(env.home.endsWith("/.c-bot")).toBe(true);
  });

  test("rejects a non-integer port", () => {
    expect(() => loadProcessEnv({ CBOT_PORT: "nope" })).toThrow(/CBOT_PORT/);
  });

  test("honors CBOT_HOME and CBOT_HOST", () => {
    const env = loadProcessEnv({
      CBOT_HOME: "/tmp/cbot-home",
      CBOT_HOST: "0.0.0.0",
      CBOT_PORT: "4090",
    });
    expect(env.home).toBe("/tmp/cbot-home");
    expect(env.host).toBe("0.0.0.0");
    expect(env.port).toBe(4090);
  });
});
