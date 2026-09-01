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
  type LlmStreamEvent,
} from "@cbot/agent";
import { handleHttp } from "../src/http.ts";
import { loadProcessEnv } from "../src/env.ts";
import { createRuntime, type Runtime } from "../src/runtime.ts";

class ScriptedLlm implements LlmClient {
  constructor(private readonly text: string) {}
  async *stream(): AsyncIterable<LlmStreamEvent> {
    yield { type: "text", text: this.text };
    yield { type: "done", finishReason: "stop" };
  }
}

type Harness = {
  runtime: Runtime;
  opts: { web: "none"; distDir: string; runtime: Runtime };
  home: string;
  sessionId: string;
};

async function harness(reply = "답"): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), "cbot-cmd-"));
  const env = loadProcessEnv({ CBOT_HOME: home, CBOT_PORT: "3080" });
  const config = await loadConfig(home);
  await saveConfig(
    home,
    upsertProvider(config, {
      id: "acme",
      displayName: "Acme",
      baseURL: "https://llm.example/v1",
      models: ["demo", "demo-pro"],
    }),
  );
  await saveProviderKey(home, "acme", "test-key");
  const runtime = await createRuntime(env, new ScriptedLlm(reply));
  const opts = { web: "none" as const, distDir: "/tmp", runtime };
  const created = await handleHttp(
    new Request("http://127.0.0.1/api/sessions", {
      method: "POST",
      body: JSON.stringify({ workspace: home }),
    }),
    opts,
  );
  const { session } = (await created.json()) as { session: { id: string } };
  return { runtime, opts, home, sessionId: session.id };
}

async function send(h: Harness, text: string): Promise<Response> {
  return handleHttp(
    new Request(`http://127.0.0.1/api/sessions/${h.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
    h.opts,
  );
}

async function settle(h: Harness): Promise<void> {
  for (let i = 0; i < 50 && !events(h).some((event) => event.type === "turn/end"); i++) {
    await Bun.sleep(20);
  }
}

function events(h: Harness): { type: string; text?: string; command?: string }[] {
  return h.runtime.store.events(h.sessionId as never) as never;
}

describe("slash commands", () => {
  test("/help answers in the log and starts no turn", async () => {
    const h = await harness();
    expect((await send(h, "/help")).status).toBe(202);
    const log = events(h);
    const notice = log.find((event) => event.type === "system/notice");
    expect(notice?.command).toBe("help");
    expect(notice?.text).toContain("/compact");
    expect(log.some((event) => event.type === "turn/start")).toBe(false);
    expect(log.some((event) => event.type === "user/message")).toBe(false);
    h.runtime.store.close();
  });

  test("a command answer never reaches the model history", async () => {
    const h = await harness();
    await send(h, "/status");
    const { deriveMessages } = await import("@cbot/agent");
    expect(deriveMessages(h.runtime.store.events(h.sessionId as never))).toEqual([]);
    h.runtime.store.close();
  });

  test("an unknown command is an ordinary message", async () => {
    const h = await harness();
    await send(h, "/deploy 지금");
    await settle(h);
    const log = events(h);
    expect(log.some((event) => event.type === "user/message")).toBe(true);
    h.runtime.store.close();
  });

  test("/model switches the active model and refuses one that is not configured", async () => {
    const h = await harness();
    await send(h, "/model demo-pro");
    expect((await loadConfig(h.home)).llm.activeModel).toBe("demo-pro");
    await send(h, "/model nope");
    expect((await loadConfig(h.home)).llm.activeModel).toBe("demo-pro");
    const last = events(h).filter((event) => event.type === "system/notice").at(-1);
    expect(last?.text).toContain("없는 모델");
    h.runtime.store.close();
  });

  test("/approvals switches the policy and rejects anything else", async () => {
    const h = await harness();
    await send(h, "/approvals allow");
    expect((await loadConfig(h.home)).approval.mode).toBe("allow");
    await send(h, "/approvals maybe");
    expect((await loadConfig(h.home)).approval.mode).toBe("allow");
    h.runtime.store.close();
  });

  test("/clear draws a boundary the model history starts from", async () => {
    const h = await harness();
    h.runtime.store.append(h.sessionId as never, {
      type: "user/message",
      text: "이전 요청",
      mentions: [],
    });
    await send(h, "/clear");
    const { deriveMessages } = await import("@cbot/agent");
    expect(deriveMessages(h.runtime.store.events(h.sessionId as never))).toEqual([]);
    expect(events(h).some((event) => event.type === "user/message")).toBe(true);
    h.runtime.store.close();
  });

  test("/compact with nothing to summarize says so instead of calling the model", async () => {
    const h = await harness();
    await send(h, "/compact");
    const notice = events(h).find((event) => event.type === "system/notice");
    expect(notice?.text).toContain("쌓이지 않았");
    h.runtime.store.close();
  });

  test("/compact summarizes the finished turns", async () => {
    const h = await harness("요약본");
    await send(h, "안녕");
    await settle(h);
    await send(h, "/compact");
    const compacted = events(h).find((event) => event.type === "context/compact");
    expect(compacted).toBeDefined();
    const { deriveMessages } = await import("@cbot/agent");
    const messages = deriveMessages(h.runtime.store.events(h.sessionId as never));
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toContain("요약본");
    h.runtime.store.close();
  });
});
