import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
    await seedProvider(home);
    const runtime = await createRuntime(
      env,
      new ScriptedLlm([
        { type: "text", text: "hello" },
        { type: "done", finishReason: "stop" },
      ]),
    );
    const opts = { web: "none" as const, distDir: "/tmp", runtime };

    const opened = await handleHttp(
      new Request("http://127.0.0.1/api/project", {
        method: "PUT",
        body: JSON.stringify({ path: home }),
      }),
      opts,
    );
    expect(opened.status).toBe(200);
    const project = (await opened.json()) as { current: string };
    expect(project.current).toBe(home);

    const created = await handleHttp(
      new Request("http://127.0.0.1/api/sessions", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      opts,
    );
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as { session: { id: string; workspace: string } };
    expect(session.workspace).toBe(home);

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

  test("creating a session without an open project is 400", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-noproj-"));
    const env = loadProcessEnv({ CBOT_HOME: home, CBOT_PORT: "3080" });
    const runtime = await createRuntime(env, new ScriptedLlm([]));
    const opts = { web: "none" as const, distDir: "/tmp", runtime };
    const res = await handleHttp(
      new Request("http://127.0.0.1/api/sessions", { method: "POST", body: "{}" }),
      opts,
    );
    expect(res.status).toBe(400);
    const listed = await handleHttp(new Request("http://127.0.0.1/api/sessions"), opts);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { sessions: unknown[] };
    expect(body.sessions).toEqual([]);
    runtime.store.close();
  });

  test("GET lists coding sessions from every workspace", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-allws-"));
    const wsA = await mkdtemp(join(tmpdir(), "cbot-ws-a-"));
    const wsB = await mkdtemp(join(tmpdir(), "cbot-ws-b-"));
    const env = loadProcessEnv({ CBOT_HOME: home, CBOT_PORT: "3080" });
    const runtime = await createRuntime(env, new ScriptedLlm([]));
    const opts = { web: "none" as const, distDir: "/tmp", runtime };

    const createdA = await handleHttp(
      new Request("http://127.0.0.1/api/sessions", {
        method: "POST",
        body: JSON.stringify({ workspace: wsA, title: "alpha" }),
      }),
      opts,
    );
    expect(createdA.status).toBe(201);
    const createdB = await handleHttp(
      new Request("http://127.0.0.1/api/sessions", {
        method: "POST",
        body: JSON.stringify({ workspace: wsB, title: "beta" }),
      }),
      opts,
    );
    expect(createdB.status).toBe(201);

    const listed = await handleHttp(new Request("http://127.0.0.1/api/sessions"), opts);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { sessions: { title: string; workspace: string }[] };
    expect(body.sessions.map((session) => session.workspace).sort()).toEqual([wsA, wsB].sort());
    expect(body.sessions.map((session) => session.title).sort()).toEqual(["alpha", "beta"]);
    runtime.store.close();
  });

  test("POST with a workspace path creates a session there", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-postws-"));
    const workspace = await mkdtemp(join(tmpdir(), "cbot-target-"));
    const env = loadProcessEnv({ CBOT_HOME: home, CBOT_PORT: "3080" });
    const runtime = await createRuntime(env, new ScriptedLlm([]));
    const opts = { web: "none" as const, distDir: "/tmp", runtime };

    const created = await handleHttp(
      new Request("http://127.0.0.1/api/sessions", {
        method: "POST",
        body: JSON.stringify({ workspace }),
      }),
      opts,
    );
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as { session: { workspace: string } };
    expect(session.workspace).toBe(resolve(workspace));

    const projectRes = await handleHttp(new Request("http://127.0.0.1/api/project"), opts);
    const project = (await projectRes.json()) as { current: string | null; recents: string[] };
    expect(project.current).toBe(resolve(workspace));
    expect(project.recents).toContain(resolve(workspace));
    runtime.store.close();
  });

  test("project view and browse default to the launch directory", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-launch-"));
    const env = loadProcessEnv({ CBOT_HOME: home, CBOT_PORT: "3080" });
    const launchDir = resolve(home);
    const runtime = await createRuntime(env, new ScriptedLlm([]), launchDir);
    const opts = { web: "none" as const, distDir: "/tmp", runtime };
    const projectRes = await handleHttp(new Request("http://127.0.0.1/api/project"), opts);
    const project = (await projectRes.json()) as { launchDir: string; current: string | null };
    expect(project.launchDir).toBe(launchDir);
    expect(project.current).toBeNull();
    const browse = await handleHttp(new Request("http://127.0.0.1/api/fs/browse"), opts);
    const listing = (await browse.json()) as { path: string };
    expect(listing.path).toBe(launchDir);
    runtime.store.close();
  });
});

describe("providers API", () => {
  test("creates a custom provider and lists it without echoing the key", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-provapi-"));
    const env = loadProcessEnv({ CBOT_HOME: home, CBOT_PORT: "3080" });
    const runtime = await createRuntime(env, new ScriptedLlm([]));
    const opts = { web: "none" as const, distDir: "/tmp", runtime };
    const created = await handleHttp(
      new Request("http://127.0.0.1/api/providers", {
        method: "POST",
        body: JSON.stringify({
          id: "acme",
          displayName: "Acme",
          baseURL: "https://gateway.example/v1",
          models: ["alpha"],
          apiKey: "secret-key",
        }),
      }),
      opts,
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      activeProvider: string;
      activeModel: string;
      providers: { id: string; hasApiKey: boolean; keyEnv: string }[];
    };
    expect(body.activeProvider).toBe("acme");
    expect(body.activeModel).toBe("alpha");
    expect(body.providers).toEqual([
      expect.objectContaining({ id: "acme", hasApiKey: true, keyEnv: "ACME_API_KEY" }),
    ]);
    const text = JSON.stringify(body);
    expect(text).not.toContain("secret-key");
    const removed = await handleHttp(new Request("http://127.0.0.1/api/providers/acme", { method: "DELETE" }), opts);
    expect(removed.status).toBe(200);
    const after = (await removed.json()) as { providers: unknown[]; hasApiKey: boolean };
    expect(after.providers).toEqual([]);
    expect(after.hasApiKey).toBe(false);
    runtime.store.close();
  });
});

describe("bots API", () => {
  test("creates a bot with a pinned model and deletes it", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-botapi-"));
    const env = loadProcessEnv({ CBOT_HOME: home, CBOT_PORT: "3080" });
    const runtime = await createRuntime(env, new ScriptedLlm([]));
    const opts = { web: "none" as const, distDir: "/tmp", runtime };
    const created = await handleHttp(
      new Request("http://127.0.0.1/api/bots", {
        method: "POST",
        body: JSON.stringify({
          handle: "researcher",
          title: "Researcher",
          description: "looks things up",
          provider: "acme",
          model: "alpha",
          thinking: "xhigh",
        }),
      }),
      opts,
    );
    expect(created.status).toBe(201);
    const { bot } = (await created.json()) as {
      bot: { id: string; handle: string; provider: string; model: string; thinking: string };
    };
    expect(bot.handle).toBe("researcher");
    expect(bot.provider).toBe("acme");
    expect(bot.model).toBe("alpha");
    expect(bot.thinking).toBe("xhigh");
    const patched = await handleHttp(
      new Request(`http://127.0.0.1/api/bots/${bot.id}`, {
        method: "PUT",
        body: JSON.stringify({ thinking: "high" }),
      }),
      opts,
    );
    expect(patched.status).toBe(200);
    const after = (await patched.json()) as { bot: { thinking: string } };
    expect(after.bot.thinking).toBe("high");
    const listedBefore = await handleHttp(new Request("http://127.0.0.1/api/bots"), opts);
    const before = (await listedBefore.json()) as { bots: { handle: string; role: string }[] };
    expect(before.bots.some((item) => item.handle === "leader" && item.role === "leader")).toBe(true);
    const removed = await handleHttp(new Request(`http://127.0.0.1/api/bots/${bot.id}`, { method: "DELETE" }), opts);
    expect(removed.status).toBe(200);
    const listed = await handleHttp(new Request("http://127.0.0.1/api/bots"), opts);
    const body = (await listed.json()) as { bots: { handle: string }[] };
    expect(body.bots.map((item) => item.handle)).toEqual(["leader"]);
    runtime.store.close();
  });
});

const TEST_WORKSPACE = "/Users/hantaekim/project/test";

class HopLlm implements LlmClient {
  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const lead = request.system.includes("`@leader`") && request.system.includes("the lead");
    const lastUser = [...request.messages].reverse().find((message) => message.role === "user");
    const hasToolResult = request.messages.some((message) => message.role === "tool");
    if (lead) {
      if (lastUser?.content.includes("(@researcher)")) {
        yield { type: "text", text: "Researcher reported back." };
        yield { type: "done", finishReason: "stop" };
        return;
      }
      if (!hasToolResult) {
        yield {
          type: "tool_call",
          id: "call_lead_hop",
          name: "message_agent",
          arguments: JSON.stringify({
            target: "researcher",
            message: "Please inspect test.txt and report its first line.",
          }),
        };
        yield { type: "done", finishReason: "tool_calls" };
        return;
      }
      yield { type: "text", text: "Researcher is on it." };
      yield { type: "done", finishReason: "stop" };
      return;
    }
    if (!hasToolResult) {
      if (!request.system.includes(TEST_WORKSPACE)) {
        throw new Error("specialist turn missing summoner workspace");
      }
      yield {
        type: "tool_call",
        id: "call_spec_hop",
        name: "message_agent",
        arguments: JSON.stringify({
          target: "leader",
          message: "First line is 테스트 파일입니다.",
        }),
      };
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }
    yield { type: "text", text: "Reported to the lead." };
    yield { type: "done", finishReason: "stop" };
  }
}

async function waitUntil(label: string, check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 80; i++) {
    if (await check()) {
      return;
    }
    await Bun.sleep(25);
  }
  throw new Error(label);
}

describe("bot hop API", () => {
  test("lead summons a specialist over HTTP and the reply lands on the coding session", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-hop-http-"));
    const env = loadProcessEnv({ CBOT_HOME: home, CBOT_PORT: "3080" });
    await seedProvider(home);
    const runtime = await createRuntime(env, new HopLlm());
    const opts = { web: "none" as const, distDir: "/tmp", runtime };

    const health = await handleHttp(new Request("http://127.0.0.1/api/health"), opts);
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as { ok: boolean };
    expect(healthBody.ok).toBe(true);

    const createdBot = await handleHttp(
      new Request("http://127.0.0.1/api/bots", {
        method: "POST",
        body: JSON.stringify({
          handle: "researcher",
          title: "Researcher",
          description: "looks things up",
        }),
      }),
      opts,
    );
    expect(createdBot.status).toBe(201);
    const { bot: researcher } = (await createdBot.json()) as {
      bot: { id: string; handle: string; sessionId: string; role: string };
    };
    expect(researcher.handle).toBe("researcher");

    const listedBots = await handleHttp(new Request("http://127.0.0.1/api/bots"), opts);
    const botsBody = (await listedBots.json()) as {
      bots: { handle: string; role: string; id: string }[];
    };
    expect(botsBody.bots.some((item) => item.handle === "leader" && item.role === "leader")).toBe(
      true,
    );
    const leader = botsBody.bots.find((item) => item.role === "leader");
    expect(leader).toBeDefined();
    const deleteLeader = await handleHttp(
      new Request(`http://127.0.0.1/api/bots/${leader?.id}`, { method: "DELETE" }),
      opts,
    );
    expect(deleteLeader.status).toBe(400);

    const refuse = await handleHttp(
      new Request(`http://127.0.0.1/api/sessions/${researcher.sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: "talk to me directly" }),
      }),
      opts,
    );
    expect(refuse.status).toBe(400);
    const refuseBody = (await refuse.json()) as { error: string };
    expect(refuseBody.error).toBe("direct bot chat is disabled");

    const created = await handleHttp(
      new Request("http://127.0.0.1/api/sessions", {
        method: "POST",
        body: JSON.stringify({ workspace: TEST_WORKSPACE }),
      }),
      opts,
    );
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as {
      session: { id: string; workspace: string };
    };
    expect(session.workspace).toBe(resolve(TEST_WORKSPACE));

    const sent = await handleHttp(
      new Request(`http://127.0.0.1/api/sessions/${session.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: "ask the researcher about test.txt" }),
      }),
      opts,
    );
    expect(sent.status).toBe(202);

    await waitUntil("specialist was not woken", async () => {
      const codingRes = await handleHttp(
        new Request(`http://127.0.0.1/api/sessions/${session.id}`),
        opts,
      );
      const codingBody = (await codingRes.json()) as {
        team: { handle: string; sessionId: string }[];
      };
      const hop = codingBody.team.find((member) => member.handle === "researcher");
      if (!hop) {
        return false;
      }
      const res = await handleHttp(
        new Request(`http://127.0.0.1/api/sessions/${hop.sessionId}`),
        opts,
      );
      const body = (await res.json()) as {
        events: { type: string; text?: string; fromHandle?: string }[];
      };
      const incoming = body.events.find((event) => event.type === "bot/message");
      return (
        Boolean(incoming?.text?.includes("Message from 🤖 Leader (@leader)")) &&
        Boolean(incoming?.text?.includes("Please inspect test.txt")) &&
        body.events.some((event) => event.type === "turn/start")
      );
    });

    await waitUntil("specialist reply did not reach the coding session", async () => {
      const res = await handleHttp(new Request(`http://127.0.0.1/api/sessions/${session.id}`), opts);
      const body = (await res.json()) as {
        events: { type: string; text?: string; fromHandle?: string; content?: string }[];
      };
      const ack = body.events.find(
        (event) => event.type === "tool/result" && event.content?.includes('"ok":true'),
      );
      const reply = body.events.find(
        (event) => event.type === "bot/message" && event.fromHandle === "researcher",
      );
      return (
        Boolean(ack) &&
        Boolean(reply?.text?.includes("Message from 🤖 Researcher (@researcher)")) &&
        Boolean(reply?.text?.includes("테스트 파일입니다."))
      );
    });

    const coding = await handleHttp(new Request(`http://127.0.0.1/api/sessions/${session.id}`), opts);
    const codingBody = (await coding.json()) as {
      events: { type: string; text?: string; content?: string }[];
    };
    const ack = codingBody.events.find((event) => event.type === "tool/result");
    expect(ack?.content).toContain('"ok":true');
    expect(ack?.content).toContain("deliveryId");
    expect(ack?.content).not.toContain("테스트 파일입니다.");

    runtime.store.close();
  });

  test("DELETE removes a coding session and refuses a bot mailbox", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-del-ses-"));
    const workspace = await mkdtemp(join(tmpdir(), "cbot-del-ws-"));
    const env = loadProcessEnv({ CBOT_HOME: home, CBOT_PORT: "3080" });
    const runtime = await createRuntime(env, new ScriptedLlm([]));
    const opts = { web: "none" as const, distDir: "/tmp", runtime };

    const created = await handleHttp(
      new Request("http://127.0.0.1/api/sessions", {
        method: "POST",
        body: JSON.stringify({ workspace }),
      }),
      opts,
    );
    const { session } = (await created.json()) as { session: { id: string } };

    const gone = await handleHttp(
      new Request(`http://127.0.0.1/api/sessions/${session.id}`, { method: "DELETE" }),
      opts,
    );
    expect(gone.status).toBe(200);
    const missing = await handleHttp(
      new Request(`http://127.0.0.1/api/sessions/${session.id}`),
      opts,
    );
    expect(missing.status).toBe(404);

    const bots = await handleHttp(new Request("http://127.0.0.1/api/bots"), opts);
    const body = (await bots.json()) as { bots: { sessionId: string; role: string }[] };
    const leader = body.bots.find((bot) => bot.role === "leader");
    expect(leader).toBeDefined();
    const refuse = await handleHttp(
      new Request(`http://127.0.0.1/api/sessions/${leader?.sessionId}`, { method: "DELETE" }),
      opts,
    );
    expect(refuse.status).toBe(400);
    const refuseBody = (await refuse.json()) as { error: string };
    expect(refuseBody.error).toBe("bot chat cannot be deleted");
    runtime.store.close();
  });

  test("DELETE /api/project forgets the folder and its coding sessions", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-del-proj-"));
    const wsA = await mkdtemp(join(tmpdir(), "cbot-proj-a-"));
    const wsB = await mkdtemp(join(tmpdir(), "cbot-proj-b-"));
    const env = loadProcessEnv({ CBOT_HOME: home, CBOT_PORT: "3080" });
    const runtime = await createRuntime(env, new ScriptedLlm([]));
    const opts = { web: "none" as const, distDir: "/tmp", runtime };

    await handleHttp(
      new Request("http://127.0.0.1/api/sessions", {
        method: "POST",
        body: JSON.stringify({ workspace: wsA, title: "alpha" }),
      }),
      opts,
    );
    await handleHttp(
      new Request("http://127.0.0.1/api/sessions", {
        method: "POST",
        body: JSON.stringify({ workspace: wsB, title: "beta" }),
      }),
      opts,
    );

    const deleted = await handleHttp(
      new Request("http://127.0.0.1/api/project", {
        method: "DELETE",
        body: JSON.stringify({ path: wsA }),
      }),
      opts,
    );
    expect(deleted.status).toBe(200);
    const project = (await deleted.json()) as { current: string | null; recents: string[] };
    expect(project.current).toBe(resolve(wsB));
    expect(project.recents).toEqual([resolve(wsB)]);

    const listed = await handleHttp(new Request("http://127.0.0.1/api/sessions"), opts);
    const sessions = (await listed.json()) as { sessions: { title: string }[] };
    expect(sessions.sessions.map((session) => session.title)).toEqual(["beta"]);

    const unknown = await handleHttp(
      new Request("http://127.0.0.1/api/project", {
        method: "DELETE",
        body: JSON.stringify({ path: wsA }),
      }),
      opts,
    );
    expect(unknown.status).toBe(404);
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
