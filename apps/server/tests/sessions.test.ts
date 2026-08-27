import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { saveXaiApiKey, type LlmClient, type LlmStreamEvent } from "@cbot/agent";
import { handleHttp } from "../src/http.ts";
import { loadProcessEnv } from "../src/env.ts";
import { createRuntime } from "../src/runtime.ts";

class ScriptedLlm implements LlmClient {
  constructor(private readonly events: LlmStreamEvent[]) {}
  async *stream(): AsyncIterable<LlmStreamEvent> {
    for (const event of this.events) {
      yield event;
    }
  }
}

async function waitForTurnEnd(fetchSession: () => Promise<{ events: { type: string }[] }>): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const body = await fetchSession();
    if (body.events.some((e) => e.type === "turn/end")) {
      return;
    }
    await Bun.sleep(20);
  }
  throw new Error("turn did not end");
}

describe("sessions API", () => {
  test("creates a session, sends a message, and stores the reconstructed turn", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-api-"));
    const env = loadProcessEnv({ CBOT_HOME: home, CBOT_PORT: "3080" });
    await saveXaiApiKey(home, "test-key");
    const runtime = await createRuntime(
      env,
      new ScriptedLlm([
        { type: "text", text: "hello" },
        { type: "done", finishReason: "stop" },
      ]),
    );
    const opts = { web: "none" as const, distDir: "/tmp", runtime };

    const created = await handleHttp(
      new Request("http://127.0.0.1/api/sessions", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      opts,
    );
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as { session: { id: string } };

    const workspaceRes = await handleHttp(
      new Request(`http://127.0.0.1/api/sessions/${session.id}`, {
        method: "PUT",
        body: JSON.stringify({ workspace: home }),
      }),
      opts,
    );
    expect(workspaceRes.status).toBe(200);

    const sent = await handleHttp(
      new Request(`http://127.0.0.1/api/sessions/${session.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: "ping" }),
      }),
      opts,
    );
    expect(sent.status).toBe(202);

    await waitForTurnEnd(async () => {
      const res = await handleHttp(new Request(`http://127.0.0.1/api/sessions/${session.id}`), opts);
      return (await res.json()) as { events: { type: string; text?: string }[] };
    });

    const got = await handleHttp(new Request(`http://127.0.0.1/api/sessions/${session.id}`), opts);
    const body = (await got.json()) as {
      session: { title: string };
      events: { type: string; text?: string }[];
    };
    expect(body.session.title).toBe("ping");
    const assistant = body.events.find((e) => e.type === "assistant/message");
    expect(assistant?.text).toBe("hello");
    runtime.store.close();
  });
});

describe("llm probe API", () => {
  test("POST /api/llm/test with an empty key returns missing_config", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-probe-"));
    const env = loadProcessEnv({ CBOT_HOME: home, CBOT_PORT: "3080" });
    const runtime = await createRuntime(env, new ScriptedLlm([]));
    const res = await handleHttp(
      new Request("http://127.0.0.1/api/llm/test", {
        method: "POST",
        body: JSON.stringify({ apiKey: "" }),
      }),
      { web: "none", distDir: "/tmp", runtime },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; reason?: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("missing_config");
    runtime.store.close();
  });
});
