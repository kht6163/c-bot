import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { SessionStore } from "@cbot/agent";
import { TaskStore, taskBoardId } from "../src/task-store.ts";
import { taskTool } from "../src/task-tool.ts";
import { createBot } from "../src/roster.ts";

describe("TaskStore", () => {
  test("keeps a session board and filters assigned unfinished work", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-tasks-"));
    const sessions = await SessionStore.open(":memory:");
    const coding = sessions.create({ kind: "coding", workspace: home });
    const lead = await createBot(home, sessions, { handle: "leaderx", title: "L", description: "L" });
    const spec = await createBot(home, sessions, { handle: "researcher", title: "R", description: "R" });
    const store = await TaskStore.open(home);
    store.create({
      boardId: coding.id,
      title: "조사",
      ownerId: spec.id,
      ownerHandle: spec.handle,
      requesterId: lead.id,
      requesterHandle: "leader",
    });
    store.create({
      boardId: coding.id,
      title: "내가 한 일",
      ownerId: spec.id,
      ownerHandle: spec.handle,
      requesterId: spec.id,
      requesterHandle: spec.handle,
      status: "completed",
    });
    const assigned = store
      .list(coding.id, { ownerHandle: spec.handle })
      .filter((item) => item.requesterHandle !== spec.handle && item.status !== "completed");
    expect(assigned.map((item) => item.title)).toEqual(["조사"]);
    store.close();
    sessions.close();
  });
});

describe("taskTool", () => {
  test("adds to the parent coding session board from a hop mailbox", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-tasktool-"));
    const sessions = await SessionStore.open(join(home, "sessions", "sessions.sqlite"));
    const coding = sessions.create({ kind: "coding", workspace: home });
    const lead = await createBot(home, sessions, { handle: "leadbot", title: "Lead", description: "L" });
    const spec = await createBot(home, sessions, { handle: "writer", title: "Writer", description: "W" });
    const hop = sessions.create({
      kind: "bot-chat",
      botId: spec.id,
      parentId: coding.id,
      workspace: home,
    });
    expect(taskBoardId(sessions, hop.id)).toBe(coding.id);
    const tool = taskTool({
      home,
      store: sessions,
      sessionId: hop.id,
      actor: lead,
      roster: [lead, spec],
    });
    const added = JSON.parse(
      await tool.execute({ action: "add", title: "초안", owner: "writer" }, {
        workspace: home,
        approvalMode: "allow",
      }),
    ) as { ok: boolean; task: { ownerHandle: string; title: string } };
    expect(added.ok).toBe(true);
    expect(added.task.ownerHandle).toBe("writer");
    const listed = JSON.parse(
      await tool.execute({ action: "list", assigned: true }, {
        workspace: home,
        approvalMode: "allow",
      }),
    ) as { tasks: { title: string }[] };
    const asWriter = taskTool({
      home,
      store: sessions,
      sessionId: hop.id,
      actor: spec,
      roster: [lead, spec],
    });
    const mine = JSON.parse(
      await asWriter.execute({ action: "list", assigned: true }, {
        workspace: home,
        approvalMode: "allow",
      }),
    ) as { tasks: { title: string }[] };
    expect(mine.tasks.map((item) => item.title)).toEqual(["초안"]);
    expect(listed.tasks).toEqual([]);
    const events = sessions.events(coding.id);
    expect(events.some((event) => event.type === "task/change")).toBe(true);
    sessions.close();
  });
});
