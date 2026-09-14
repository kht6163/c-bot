import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { SessionStore, deriveMessages } from "@cbot/agent";
import { AGENT_STATUS_MAX, latestAgentStatus } from "@cbot/shared";
import { createBot, ensureLeaderBot, listBots, updateBot } from "../src/roster.ts";
import { protocolSection } from "../src/protocol.ts";
import { statusTool } from "../src/status-tool.ts";

async function bot(home: string, store: SessionStore) {
  return createBot(home, store, { handle: "worker", title: "Worker", description: "W" });
}

describe("set_status", () => {
  test("the line a bot sets is the line the log hands back", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-status-"));
    const store = await SessionStore.open(":memory:");
    const actor = await bot(home, store);
    const tool = statusTool({ store, sessionId: actor.sessionId, actor });

    await tool.execute({ text: "로그인 버그 재현 중" }, {} as never);
    expect(latestAgentStatus(store.events(actor.sessionId))?.text).toBe("로그인 버그 재현 중");

    await tool.execute({ text: "CI 결과 기다리는 중" }, {} as never);
    const current = latestAgentStatus(store.events(actor.sessionId));
    expect(current?.text).toBe("CI 결과 기다리는 중");
    expect(current?.handle).toBe("worker");
    expect(current?.botId).toBe(actor.id);
    store.close();
  });

  test("an empty line clears the status instead of leaving the last one up", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-status-clear-"));
    const store = await SessionStore.open(":memory:");
    const actor = await bot(home, store);
    const tool = statusTool({ store, sessionId: actor.sessionId, actor });

    await tool.execute({ text: "빌드 돌리는 중" }, {} as never);
    await tool.execute({ text: "   " }, {} as never);

    expect(latestAgentStatus(store.events(actor.sessionId))).toBeUndefined();
    // Clearing is still an event: the log keeps both, the reader takes the last.
    expect(store.events(actor.sessionId).filter((e) => e.type === "agent/status")).toHaveLength(2);
    store.close();
  });

  test("a long or multi-line status arrives as one clipped row", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-status-clip-"));
    const store = await SessionStore.open(":memory:");
    const actor = await bot(home, store);
    const tool = statusTool({ store, sessionId: actor.sessionId, actor });

    await tool.execute({ text: "첫 줄\n\n둘째  줄" }, {} as never);
    expect(latestAgentStatus(store.events(actor.sessionId))?.text).toBe("첫 줄 둘째 줄");

    await tool.execute({ text: "가".repeat(AGENT_STATUS_MAX + 20) }, {} as never);
    const clipped = latestAgentStatus(store.events(actor.sessionId))?.text ?? "";
    expect(clipped).toHaveLength(AGENT_STATUS_MAX);
    expect(clipped.endsWith("…")).toBe(true);
    store.close();
  });

  test("the status never reaches model history", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-status-derive-"));
    const store = await SessionStore.open(":memory:");
    const actor = await bot(home, store);
    store.append(actor.sessionId, { type: "user/message", text: "안녕", mentions: [] });
    await statusTool({ store, sessionId: actor.sessionId, actor }).execute(
      { text: "인사 답하는 중" },
      {} as never,
    );

    const messages = deriveMessages(store.events(actor.sessionId));
    expect(JSON.stringify(messages)).not.toContain("인사 답하는 중");
    store.close();
  });

  test("the protocol tells a bot about the line only when it has the tool", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-status-prompt-"));
    const store = await SessionStore.open(":memory:");
    const leader = await ensureLeaderBot(home, store);
    const worker = await bot(home, store);
    const roster = await listBots(home);

    expect(protocolSection(leader, roster, leader.soul)).toContain("`set_status`");
    expect(protocolSection(worker, roster, worker.soul)).toContain("`set_status`");

    const quiet = await updateBot(home, worker.id, { tools: ["bash"] });
    expect(protocolSection(quiet!, roster, quiet!.soul)).not.toContain("set_status");
    store.close();
  });
});
