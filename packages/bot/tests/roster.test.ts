import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { SessionStore } from "@cbot/agent";
import { createBot, listBots, loadBot } from "../src/roster.ts";
import { protocolSection } from "../src/protocol.ts";
import { PROTOCOL_HEADING } from "../src/types.ts";
import { messageAgentTool } from "../src/message-agent.ts";
import { deriveMessages } from "@cbot/agent";

describe("roster", () => {
  test("creates isolated bots with canonical Bot Chat sessions", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-bots-"));
    const store = await SessionStore.open(join(home, "sessions", "sessions.sqlite"));
    const researcher = await createBot(home, store, {
      handle: "researcher",
      title: "Researcher",
      description: "looks things up",
    });
    const writer = await createBot(home, store, {
      handle: "writer",
      title: "Writer",
      description: "drafts text",
    });
    const roster = await listBots(home);
    expect(roster.map((b) => b.handle)).toEqual(["researcher", "writer"]);
    const session = store.get(researcher.sessionId);
    expect(session?.kind).toBe("bot-chat");
    expect(session?.title).toBe("Bot Chat");
    expect(session?.botId).toBe(researcher.id);
    const loaded = await loadBot(home, writer.id);
    expect(loaded?.soul).toContain("Writer");
    store.close();
  });
});

describe("protocol", () => {
  test("lists teammates and skips when SOUL already has the heading", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-proto-"));
    const store = await SessionStore.open(":memory:");
    const a = await createBot(home, store, { handle: "alpha", title: "Alpha", description: "A" });
    const b = await createBot(home, store, { handle: "beta", title: "Beta", description: "B" });
    const roster = await listBots(home);
    const section = protocolSection(a, roster, a.soul);
    expect(section).toContain(PROTOCOL_HEADING);
    expect(section).toContain("`@beta`");
    expect(section).not.toContain("`@alpha` —");
    expect(protocolSection(a, roster, `${PROTOCOL_HEADING}\n`)).toBe("");
    expect(b.handle).toBe("beta");
    store.close();
  });
});

describe("message_agent", () => {
  test("is fire-and-forget, attributes the body, and refuses the wrong session kind", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-dm-"));
    const store = await SessionStore.open(join(home, "sessions", "sessions.sqlite"));
    const a = await createBot(home, store, { handle: "alpha", title: "Alpha", description: "A" });
    const b = await createBot(home, store, { handle: "beta", title: "Beta", description: "B" });
    const woken: string[] = [];
    const tool = messageAgentTool({
      home,
      store,
      sessionId: a.sessionId,
      sessionKind: "bot-chat",
      fromBotId: a.id,
      wake: (id) => {
        woken.push(id);
      },
    });
    const result = JSON.parse(
      await tool.execute({ target: "beta", message: "please review" }, {
        workspace: "",
        approvalMode: "allow",
      }),
    ) as { ok: boolean; deliveryId: string };
    expect(result.ok).toBe(true);
    expect(woken).toEqual([b.sessionId]);
    const events = store.events(b.sessionId);
    const incoming = events.find((e) => e.type === "bot/message");
    expect(incoming?.type === "bot/message" && incoming.text).toContain("Message from 🤖 Alpha (@alpha)");
    expect(incoming?.type === "bot/message" && incoming.text).toContain("please review");
    const blocked = messageAgentTool({
      home,
      store,
      sessionId: a.sessionId,
      sessionKind: "coding",
      fromBotId: a.id,
      wake: () => {},
    });
    const denied = JSON.parse(
      await blocked.execute({ target: "beta", message: "nope" }, { workspace: "", approvalMode: "allow" }),
    ) as { ok: boolean; reason: string };
    expect(denied.reason).toBe("not_bot_chat");
    expect(deriveMessages(store.events(b.sessionId)).some((m) => m.role === "user")).toBe(true);
    store.close();
  });

  test("refuses unknown and self targets", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-dm2-"));
    const store = await SessionStore.open(join(home, "sessions", "sessions.sqlite"));
    const a = await createBot(home, store, { handle: "alpha", title: "Alpha", description: "A" });
    const tool = messageAgentTool({
      home,
      store,
      sessionId: a.sessionId,
      sessionKind: "bot-chat",
      fromBotId: a.id,
      wake: () => {},
    });
    const self = JSON.parse(
      await tool.execute({ target: "alpha", message: "hi" }, { workspace: "", approvalMode: "allow" }),
    ) as { reason: string };
    expect(self.reason).toBe("target_self");
    const missing = JSON.parse(
      await tool.execute({ target: "ghost", message: "hi" }, { workspace: "", approvalMode: "allow" }),
    ) as { reason: string };
    expect(missing.reason).toBe("target_not_found");
    store.close();
  });
});
