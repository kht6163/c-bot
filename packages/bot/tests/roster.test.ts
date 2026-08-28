import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { SessionStore } from "@cbot/agent";
import { createBot, deleteBot, ensureLeaderBot, listBots, loadBot } from "../src/roster.ts";
import { protocolSection } from "../src/protocol.ts";
import { PROTOCOL_HEADING } from "../src/types.ts";
import { messageAgentTool, workspaceForMailbox } from "../src/message-agent.ts";
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
    const pinned = await createBot(home, store, {
      handle: "coder",
      title: "Coder",
      description: "writes",
      provider: "acme",
      model: "alpha",
      thinking: "xhigh",
    });
    expect(pinned.provider).toBe("acme");
    expect(pinned.model).toBe("alpha");
    expect(pinned.thinking).toBe("xhigh");
    const reloaded = await loadBot(home, pinned.id);
    expect(reloaded?.thinking).toBe("xhigh");
    expect(await deleteBot(home, writer.id)).toBe(true);
    expect((await listBots(home)).map((b) => b.handle)).toEqual(["coder", "researcher"]);
    store.close();
  });

  test("ensures a leader that cannot be deleted", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-leader-"));
    const store = await SessionStore.open(join(home, "sessions", "sessions.sqlite"));
    const leader = await ensureLeaderBot(home, store);
    expect(leader.handle).toBe("leader");
    expect(leader.role).toBe("leader");
    const again = await ensureLeaderBot(home, store);
    expect(again.id).toBe(leader.id);
    await expect(deleteBot(home, leader.id)).rejects.toThrow("leader cannot be deleted");
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
    const fromCoding = messageAgentTool({
      home,
      store,
      sessionId: a.sessionId,
      sessionKind: "coding",
      fromBotId: a.id,
      wake: () => {},
    });
    const fromLead = JSON.parse(
      await fromCoding.execute({ target: "beta", message: "from coding" }, { workspace: "", approvalMode: "allow" }),
    ) as { ok: boolean };
    expect(fromLead.ok).toBe(true);
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

  test("specialist reply to the lead lands on the originating coding session", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-hop-"));
    const store = await SessionStore.open(join(home, "sessions", "sessions.sqlite"));
    const leader = await ensureLeaderBot(home, store);
    const researcher = await createBot(home, store, {
      handle: "researcher",
      title: "Researcher",
      description: "looks things up",
    });
    const coding = store.create({
      kind: "coding",
      workspace: "/Users/hantaekim/project/test",
    });
    const woken: string[] = [];
    const fromLead = messageAgentTool({
      home,
      store,
      sessionId: coding.id,
      sessionKind: "coding",
      fromBotId: leader.id,
      wake: (id) => {
        woken.push(id);
      },
    });
    const outbound = JSON.parse(
      await fromLead.execute(
        { target: "researcher", message: "please inspect test.txt" },
        { workspace: coding.workspace ?? "", approvalMode: "allow" },
      ),
    ) as { ok: boolean };
    expect(outbound.ok).toBe(true);
    const hop = store.list({ kind: "bot-chat", parentId: coding.id, botId: researcher.id })[0];
    expect(hop?.id).toBeDefined();
    expect(hop?.id).not.toBe(researcher.sessionId);
    const inbound = store.events(hop!.id).find((event) => event.type === "bot/message");
    expect(inbound?.type === "bot/message" && inbound.replyToSessionId).toBe(coding.id);
    expect(inbound?.type === "bot/message" && inbound.text).toContain(
      "Message from 🤖 Leader (@leader)",
    );
    expect(store.events(researcher.sessionId).some((event) => event.type === "bot/message")).toBe(
      false,
    );
    const fromSpecialist = messageAgentTool({
      home,
      store,
      sessionId: hop!.id,
      sessionKind: "bot-chat",
      fromBotId: researcher.id,
      wake: (id) => {
        woken.push(id);
      },
    });
    const reply = JSON.parse(
      await fromSpecialist.execute(
        { target: "leader", message: "first line is 테스트 파일입니다." },
        { workspace: "", approvalMode: "allow" },
      ),
    ) as { ok: boolean };
    expect(reply.ok).toBe(true);
    const onCoding = store.events(coding.id).filter((event) => event.type === "bot/message");
    expect(onCoding).toHaveLength(1);
    expect(onCoding[0]?.type === "bot/message" && onCoding[0].text).toContain(
      "Message from 🤖 Researcher (@researcher)",
    );
    expect(onCoding[0]?.type === "bot/message" && onCoding[0].text).toContain("테스트 파일입니다.");
    expect(woken).toEqual([hop!.id, coding.id]);
    expect(workspaceForMailbox(store, hop!.id)).toBe("/Users/hantaekim/project/test");

    const other = store.create({
      kind: "coding",
      workspace: "/Users/hantaekim/project/test",
    });
    const fromLeadOther = messageAgentTool({
      home,
      store,
      sessionId: other.id,
      sessionKind: "coding",
      fromBotId: leader.id,
      wake: () => {},
    });
    await fromLeadOther.execute(
      { target: "researcher", message: "second coding session" },
      { workspace: other.workspace ?? "", approvalMode: "allow" },
    );
    const otherHop = store.list({ kind: "bot-chat", parentId: other.id, botId: researcher.id })[0];
    expect(otherHop?.id).not.toBe(hop?.id);
    expect(store.events(otherHop!.id).some((event) => event.type === "bot/message")).toBe(true);
    expect(store.events(hop!.id).filter((event) => event.type === "bot/message")).toHaveLength(1);
    store.close();
  });
});
