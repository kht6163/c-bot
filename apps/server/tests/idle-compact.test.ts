import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  LlmError,
  loadConfig,
  saveConfig,
  saveProviderKey,
  upsertProvider,
  type LlmClient,
  type LlmStreamEvent,
} from "@cbot/agent";
import { createBot, listBots, updateBot } from "@cbot/bot";
import { asSessionId, asTurnId, type SessionId } from "@cbot/shared";
import { handleHttp } from "../src/http.ts";
import { loadProcessEnv } from "../src/env.ts";
import {
  flushPendingIdleCompact,
  resetIdleCompactState,
  tickIdleCompact,
} from "../src/idle-compact.ts";
import { createRuntime, type Runtime } from "../src/runtime.ts";

class ScriptedLlm implements LlmClient {
  constructor(private readonly text: string) {}
  async *stream(): AsyncIterable<LlmStreamEvent> {
    yield { type: "text", text: this.text };
    yield { type: "done", finishReason: "stop" };
  }
}

async function setup(): Promise<{ runtime: Runtime; home: string; codingId: string }> {
  resetIdleCompactState();
  const home = await mkdtemp(join(tmpdir(), "cbot-idle-"));
  const env = loadProcessEnv({ CBOT_HOME: home, CBOT_PORT: "3081" });
  const config = await loadConfig(home);
  await saveConfig(
    home,
    {
      ...upsertProvider(config, {
        id: "acme",
        displayName: "Acme",
        baseURL: "https://llm.example/v1",
        models: ["demo"],
      }),
      context: { autoCompact: true, maxTokens: 80, compactAt: 0.5, keepRecentTurns: 2 },
    },
  );
  await saveProviderKey(home, "acme", "test-key");
  const runtime = await createRuntime(env, new ScriptedLlm("세션 요약본"));
  const opts = { web: "none" as const, distDir: "/tmp", runtime };
  const created = await handleHttp(
    new Request("http://127.0.0.1/api/sessions", {
      method: "POST",
      body: JSON.stringify({ workspace: home }),
    }),
    opts,
  );
  const { session } = (await created.json()) as { session: { id: string } };
  return { runtime, home, codingId: session.id };
}

/** Finished turns large enough to cross a low compactAt threshold. */
function seedHeavyTurns(runtime: Runtime, sessionId: SessionId, label: string): void {
  for (let n = 1; n <= 6; n++) {
    const turnId = asTurnId(`turn-${label}-${n}`);
    runtime.store.append(sessionId, {
      type: "user/message",
      text: `${label} 요청 ${n} `.repeat(30),
      mentions: [],
    });
    runtime.store.append(sessionId, { type: "turn/start", turnId });
    runtime.store.append(sessionId, {
      type: "assistant/message",
      turnId,
      text: `${label} 답 ${n} `.repeat(30),
      toolCalls: [],
    });
    runtime.store.append(sessionId, { type: "turn/end", turnId });
  }
}

describe("idle auto compact", () => {
  test("default off does nothing even when idle and over compactAt", async () => {
    const { runtime, codingId } = await setup();
    const id = asSessionId(codingId);
    seedHeavyTurns(runtime, id, "off");
    await tickIdleCompact(runtime, () => false, Date.now() + 120_000);
    expect(runtime.store.events(id).some((event) => event.type === "context/compact")).toBe(false);
    runtime.store.close();
  });

  test("leader idle setting compacts only the coding session via /compact path", async () => {
    const { runtime, home, codingId } = await setup();
    const bots = await listBots(home);
    const leader = bots.find((bot) => bot.role === "leader");
    expect(leader).toBeDefined();
    await updateBot(home, leader!.id, { autoCompactIdle: true, autoCompactIdleMs: 30_000 });

    const specialist = await createBot(home, runtime.store, {
      handle: "researcher",
      title: "Researcher",
      description: "looks up",
    });
    await updateBot(home, specialist.id, { autoCompactIdle: false, autoCompactIdleMs: 30_000 });

    const coding = asSessionId(codingId);
    seedHeavyTurns(runtime, coding, "lead");
    seedHeavyTurns(runtime, specialist.sessionId, "hop");

    await tickIdleCompact(runtime, () => false, Date.now() + 120_000);
    const codingCompact = runtime.store
      .events(coding)
      .filter((event) => event.type === "context/compact");
    expect(codingCompact).toHaveLength(1);
    expect(codingCompact[0]?.type === "context/compact" && codingCompact[0].auto).toBe(true);
    expect(
      runtime.store.events(specialist.sessionId).some((event) => event.type === "context/compact"),
    ).toBe(false);
    runtime.store.close();
  });

  test("busy session defers once then runs after flush", async () => {
    const { runtime, home, codingId } = await setup();
    const bots = await listBots(home);
    const leader = bots.find((bot) => bot.role === "leader")!;
    await updateBot(home, leader.id, { autoCompactIdle: true, autoCompactIdleMs: 1_000 });
    const coding = asSessionId(codingId);
    seedHeavyTurns(runtime, coding, "busy");
    let busy = true;
    await tickIdleCompact(runtime, () => busy, Date.now() + 120_000);
    expect(runtime.store.events(coding).some((event) => event.type === "context/compact")).toBe(false);
    busy = false;
    flushPendingIdleCompact(runtime, coding, () => busy);
    for (let i = 0; i < 50; i++) {
      if (runtime.store.events(coding).some((event) => event.type === "context/compact")) {
        break;
      }
      await Bun.sleep(20);
    }
    expect(runtime.store.events(coding).some((event) => event.type === "context/compact")).toBe(true);
    runtime.store.close();
  });

  test("LLM failure does not stamp attemptedAtSeq — same seq retries", async () => {
    resetIdleCompactState();
    const home = await mkdtemp(join(tmpdir(), "cbot-idle-fail-"));
    const env = loadProcessEnv({ CBOT_HOME: home, CBOT_PORT: "3081" });
    const config = await loadConfig(home);
    await saveConfig(
      home,
      {
        ...upsertProvider(config, {
          id: "acme",
          displayName: "Acme",
          baseURL: "https://llm.example/v1",
          models: ["demo"],
        }),
        context: { autoCompact: true, maxTokens: 80, compactAt: 0.5, keepRecentTurns: 2 },
      },
    );
    await saveProviderKey(home, "acme", "test-key");
    const flip: LlmClient & { fails: number } = {
      fails: 1,
      async *stream() {
        if (flip.fails > 0) {
          flip.fails -= 1;
          throw new LlmError("compact boom", "network");
        }
        yield { type: "text", text: "세션 요약본" };
        yield { type: "done", finishReason: "stop" };
      },
    };
    const runtime = await createRuntime(env, flip);
    const opts = { web: "none" as const, distDir: "/tmp", runtime };
    const created = await handleHttp(
      new Request("http://127.0.0.1/api/sessions", {
        method: "POST",
        body: JSON.stringify({ workspace: home }),
      }),
      opts,
    );
    const { session } = (await created.json()) as { session: { id: string } };
    const bots = await listBots(home);
    const leader = bots.find((bot) => bot.role === "leader")!;
    await updateBot(home, leader.id, { autoCompactIdle: true, autoCompactIdleMs: 1_000 });
    const coding = asSessionId(session.id);
    seedHeavyTurns(runtime, coding, "fail");
    const now = Date.now() + 120_000;
    await tickIdleCompact(runtime, () => false, now);
    expect(runtime.store.events(coding).some((event) => event.type === "context/compact")).toBe(false);
    await tickIdleCompact(runtime, () => false, now);
    expect(runtime.store.events(coding).some((event) => event.type === "context/compact")).toBe(true);
    runtime.store.close();
  });
});
