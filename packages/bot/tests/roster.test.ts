import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { CODING_TOOLS, SessionStore } from "@cbot/agent";
import { BOT_TOOLS } from "@cbot/shared";
import { createBot, deleteBot, ensureLeaderBot, listBots, loadBot, updateBot } from "../src/roster.ts";
import { protocolSection } from "../src/protocol.ts";
import { PROTOCOL_HEADING } from "../src/types.ts";
import { messageAgentTool, workspaceForMailbox } from "../src/message-agent.ts";
import { MemoryStore } from "../src/memory-store.ts";
import { memoryTool } from "../src/memory-tool.ts";
import { taskTool } from "../src/task-tool.ts";
import { recallIntoSession } from "../src/recall.ts";
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

describe("hidden bots", () => {
  test("hiding persists, drops the bot from the prompt roster, and never applies to the leader", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-hidden-"));
    const store = await SessionStore.open(":memory:");
    const leader = await ensureLeaderBot(home, store);
    const quiet = await createBot(home, store, { handle: "quiet", title: "Quiet", description: "Q" });
    const loud = await createBot(home, store, { handle: "loud", title: "Loud", description: "L" });
    const updated = await updateBot(home, quiet.id, { hidden: true });
    expect(updated?.hidden).toBe(true);
    expect((await loadBot(home, quiet.id))?.hidden).toBe(true);
    const roster = await listBots(home);
    expect(roster.find((bot) => bot.id === quiet.id)?.hidden).toBe(true);
    const section = protocolSection(leader, roster, leader.soul);
    expect(section).toContain("`@loud`");
    expect(section).not.toContain("`@quiet`");
    await expect(updateBot(home, leader.id, { hidden: true })).rejects.toThrow("leader cannot be hidden");
    const back = await updateBot(home, quiet.id, { hidden: false });
    expect(back?.hidden).toBe(false);
    expect(loud.hidden).toBe(false);
    store.close();
  });
});

describe("bot tools", () => {
  test("a bot starts with every tool and keeps the choice it is given", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-tools-"));
    const store = await SessionStore.open(":memory:");
    const open = await createBot(home, store, { handle: "open", title: "Open", description: "O" });
    expect(open.tools).toBeNull();
    const reader = await createBot(home, store, {
      handle: "reader",
      title: "Reader",
      description: "R",
      tools: ["grep", "read_file", "grep"],
    });
    expect(reader.tools).toEqual(["read_file", "grep"]);
    expect((await loadBot(home, reader.id))?.tools).toEqual(["read_file", "grep"]);
    const silent = await updateBot(home, reader.id, { tools: [] });
    expect(silent?.tools).toEqual([]);
    expect((await loadBot(home, reader.id))?.tools).toEqual([]);
    const renamed = await updateBot(home, reader.id, { title: "Quiet" });
    expect(renamed?.tools).toEqual([]);
    const back = await updateBot(home, reader.id, { tools: [...BOT_TOOLS] });
    expect(back?.tools).toBeNull();
    expect((await listBots(home)).find((bot) => bot.id === reader.id)?.tools).toBeNull();
    store.close();
  });

  test("every tool a bot can be given is a choice, and message_agent is not", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-catalog-"));
    const store = await SessionStore.open(":memory:");
    const bot = await createBot(home, store, { handle: "alpha", title: "Alpha", description: "A" });
    const given = [
      ...CODING_TOOLS.map((tool) => tool.name),
      memoryTool(home, bot.id).name,
      taskTool({ home, store, sessionId: bot.sessionId, actor: bot, roster: [bot] }).name,
      "github_create_pr",
    ];
    expect([...given].sort()).toEqual([...BOT_TOOLS].sort());
    const talk = messageAgentTool({
      home,
      store,
      sessionId: bot.sessionId,
      sessionKind: "bot-chat",
      fromBotId: bot.id,
      wake: () => {},
    });
    expect(BOT_TOOLS as readonly string[]).not.toContain(talk.name);
    store.close();
  });

  test("the protocol tells a bot about the board only when it has the task tool", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-board-"));
    const store = await SessionStore.open(":memory:");
    const leader = await ensureLeaderBot(home, store);
    const worker = await createBot(home, store, { handle: "worker", title: "Worker", description: "W" });
    const roster = await listBots(home);
    expect(protocolSection(leader, roster, leader.soul)).toContain("`task` tool");
    expect(protocolSection(worker, roster, worker.soul)).toContain("`task` tool");
    const lead = await updateBot(home, leader.id, { tools: ["read_file"] });
    const solo = await updateBot(home, worker.id, { tools: ["bash"] });
    const leadText = protocolSection(lead!, roster, lead!.soul);
    const soloText = protocolSection(solo!, roster, solo!.soul);
    expect(leadText).not.toContain("`task`");
    expect(soloText).not.toContain("`task`");
    expect(leadText).toContain("`message_agent`");
    expect(soloText).toContain("`message_agent`");
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
    const workspace = await mkdtemp(join(tmpdir(), "cbot-hop-ws-"));
    const store = await SessionStore.open(join(home, "sessions", "sessions.sqlite"));
    const leader = await ensureLeaderBot(home, store);
    const researcher = await createBot(home, store, {
      handle: "researcher",
      title: "Researcher",
      description: "looks things up",
    });
    const coding = store.create({
      kind: "coding",
      workspace,
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
    expect(workspaceForMailbox(store, hop!.id)).toBe(workspace);

    const other = store.create({
      kind: "coding",
      workspace,
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

describe("recallIntoSession", () => {
  test("writes matching memory into the session log once", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-recall-"));
    const store = await SessionStore.open(join(home, "sessions", "sessions.sqlite"));
    const bot = await createBot(home, store, { handle: "alpha", title: "Alpha", description: "A" });
    const memory = await MemoryStore.open(home, bot.id);
    memory.create({ title: "세션", body: "로그가 진실이다" });
    memory.close();
    const session = store.create({ kind: "coding" });
    store.append(session.id, { type: "user/message", text: "세션 규칙이 뭐야", mentions: [] });
    await recallIntoSession(home, bot.id, store, session.id);
    await recallIntoSession(home, bot.id, store, session.id);
    const recalls = store.events(session.id).filter((event) => event.type === "memory/recall");
    expect(recalls).toHaveLength(1);
    expect(recalls[0]?.type === "memory/recall" && recalls[0].items[0]?.title).toBe("세션");
    store.close();
  });
});
