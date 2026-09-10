import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  loadConfig,
  saveConfig,
  saveProviderKey,
  upsertProvider,
  type LlmClient,
  type LlmRequest,
  type LlmStreamEvent,
} from "@cbot/agent";
import { asBotId, asTurnId, type ServerFrame } from "@cbot/shared";
import { isCodingSessionRunning, runningCodingSessions } from "../src/activity.ts";
import { loadProcessEnv } from "../src/env.ts";
import { handleHttp } from "../src/http.ts";
import { createRuntime } from "../src/runtime.ts";
import { onWsOpen } from "../src/ws.ts";

/** Streams one chunk and then waits for an interrupt, so the turn stays open on purpose. */
class HangingLlm implements LlmClient {
  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    yield { type: "text", text: "생각" };
    await new Promise<void>((resolve) => {
      request.signal?.addEventListener("abort", () => resolve(), { once: true });
    });
    throw new Error("aborted");
  }
}

class FakeSocket {
  readonly frames: ServerFrame[] = [];
  send(data: string): void {
    this.frames.push(JSON.parse(data) as ServerFrame);
  }
  activity(): { sessionId: string; running: boolean }[] {
    return this.frames.flatMap((frame) =>
      frame.type === "session/activity" ? [{ sessionId: frame.sessionId, running: frame.running }] : [],
    );
  }
}

async function seedProvider(home: string): Promise<void> {
  const config = await loadConfig(home);
  await saveConfig(
    home,
    upsertProvider(config, {
      id: "acme",
      displayName: "Acme",
      baseURL: "https://llm.example/v1",
      models: ["demo"],
    }),
  );
  await saveProviderKey(home, "acme", "test-key");
}

describe("session activity", () => {
  test("every socket hears a coding session start and stop, and the list says who is running", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-activity-"));
    const env = loadProcessEnv({ CBOT_HOME: home, CBOT_PORT: "3080" });
    await seedProvider(home);
    const runtime = await createRuntime(env, new HangingLlm());
    const opts = { web: "none" as const, distDir: "/tmp", runtime };
    const bystander = new FakeSocket();
    onWsOpen(bystander, runtime);

    const created = await handleHttp(
      new Request("http://127.0.0.1/api/sessions", {
        method: "POST",
        body: JSON.stringify({ workspace: home }),
      }),
      opts,
    );
    const { session } = (await created.json()) as { session: { id: string } };
    const sent = await handleHttp(
      new Request(`http://127.0.0.1/api/sessions/${session.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: "오래 걸리는 일" }),
      }),
      opts,
    );
    expect(sent.status).toBe(202);
    for (let i = 0; i < 50 && bystander.activity().length === 0; i++) {
      await Bun.sleep(20);
    }
    expect(bystander.activity()).toEqual([{ sessionId: session.id, running: true }]);

    const listed = (await (await handleHttp(new Request("http://127.0.0.1/api/sessions"), opts)).json()) as {
      running: string[];
    };
    expect(listed.running).toEqual([session.id]);

    await handleHttp(new Request(`http://127.0.0.1/api/sessions/${session.id}/interrupt`, { method: "POST" }), opts);
    for (let i = 0; i < 50 && bystander.activity().length < 2; i++) {
      await Bun.sleep(20);
    }
    expect(bystander.activity()).toEqual([
      { sessionId: session.id, running: true },
      { sessionId: session.id, running: false },
    ]);
    const after = (await (await handleHttp(new Request("http://127.0.0.1/api/sessions"), opts)).json()) as {
      running: string[];
    };
    expect(after.running).toEqual([]);
    expect(bystander.frames.filter((frame) => frame.type === "event")).toEqual([]);
    runtime.store.close();
  });

  test("a specialist hop keeps its coding session running; a canonical bot chat marks nothing", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-activity-hop-"));
    const env = loadProcessEnv({ CBOT_HOME: home, CBOT_PORT: "3080" });
    const runtime = await createRuntime(env, new HangingLlm());
    const listener = new FakeSocket();
    onWsOpen(listener, runtime);
    const coding = runtime.store.create({ workspace: home });
    const hop = runtime.store.create({ kind: "bot-chat", botId: asBotId("bot-x"), parentId: coding.id });
    const canonical = runtime.store.create({ kind: "bot-chat", botId: asBotId("bot-y") });

    runtime.store.append(hop.id, { type: "turn/start", turnId: asTurnId("t1") });
    expect(isCodingSessionRunning(runtime.store, coding.id)).toBe(true);
    expect(runningCodingSessions(runtime.store)).toEqual([coding.id]);
    runtime.store.append(hop.id, { type: "turn/end", turnId: asTurnId("t1") });
    expect(runningCodingSessions(runtime.store)).toEqual([]);

    runtime.store.append(canonical.id, { type: "turn/start", turnId: asTurnId("t2") });
    expect(listener.activity()).toEqual([
      { sessionId: coding.id, running: true },
      { sessionId: coding.id, running: false },
    ]);
    runtime.store.close();
  });
});
