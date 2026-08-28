import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SessionStore } from "@cbot/agent";
import type { BotId, SessionId } from "@cbot/shared";
import { TaskStore, taskBoardId, tasksDbPath } from "../src/task-store.ts";
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

describe("TaskStore board isolation", () => {
  test("a task on another board cannot be updated", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-tasks-"));
    const sessions = await SessionStore.open(":memory:");
    const mine = sessions.create({ kind: "coding", workspace: home });
    const theirs = sessions.create({ kind: "coding", workspace: home });
    const bot = await createBot(home, sessions, { handle: "owner", title: "O", description: "O" });
    const store = await TaskStore.open(home);
    const entry = store.create({
      boardId: theirs.id,
      title: "남의 일",
      ownerId: bot.id,
      ownerHandle: bot.handle,
      requesterId: bot.id,
      requesterHandle: bot.handle,
    });
    expect(store.update(entry.id, mine.id, { status: "completed" })).toBeUndefined();
    expect(store.get(entry.id)?.status).toBe("pending");
    expect(store.update(entry.id, theirs.id, { status: "completed" })?.status).toBe("completed");
    store.close();
    sessions.close();
  });
});

describe("TaskStore subtasks", () => {
  test("keeps the board two levels deep", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-tasks-"));
    const sessions = await SessionStore.open(":memory:");
    const board = sessions.create({ kind: "coding", workspace: home });
    const other = sessions.create({ kind: "coding", workspace: home });
    const bot = await createBot(home, sessions, { handle: "worker", title: "W", description: "W" });
    const store = await TaskStore.open(home);
    const who = { ownerId: bot.id, ownerHandle: bot.handle, requesterId: bot.id, requesterHandle: bot.handle };

    const job = store.create({ boardId: board.id, title: "로그인", ...who });
    const piece = store.create({ boardId: board.id, parentId: job.id, title: "폼", ...who });
    expect(piece.parentId).toBe(job.id);
    expect(store.children(job.id).map((item) => item.id)).toEqual([piece.id]);

    expect(() => store.create({ boardId: board.id, parentId: piece.id, title: "더", ...who })).toThrow(
      "subtasks are one level deep",
    );
    expect(() => store.create({ boardId: board.id, parentId: "task_nope", title: "더", ...who })).toThrow(
      "unknown parent task",
    );

    const outsider = store.create({ boardId: other.id, title: "남의 일", ...who });
    expect(() => store.create({ boardId: board.id, parentId: outsider.id, title: "더", ...who })).toThrow(
      "unknown parent task",
    );

    expect(() => store.update(job.id, board.id, { parentId: piece.id })).toThrow(
      "subtasks are one level deep",
    );
    expect(() => store.update(piece.id, board.id, { parentId: piece.id })).toThrow(
      "a task cannot be its own parent",
    );

    const sibling = store.create({ boardId: board.id, title: "배포", ...who });
    expect(() => store.update(job.id, board.id, { parentId: sibling.id })).toThrow(
      "a task with subtasks cannot become a subtask",
    );

    expect(store.update(piece.id, board.id, { parentId: null })?.parentId).toBeNull();
    expect(store.update(piece.id, board.id, { status: "completed" })?.parentId).toBeNull();
    store.close();
    sessions.close();
  });

  test("a board written before subtasks gains the column and keeps its rows", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-tasks-"));
    await mkdir(join(home, "tasks"), { recursive: true });
    // The pre-subtask schema, written by hand: no parent_id column.
    const old = new Database(tasksDbPath(home));
    old.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        owner_handle TEXT NOT NULL,
        requester_id TEXT NOT NULL,
        requester_handle TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    old
      .query(
        `INSERT INTO tasks (id, board_id, title, detail, status, owner_id, owner_handle,
            requester_id, requester_handle, created_at, updated_at)
          VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("task_old", "ses_board", "예전 일", "pending", "bot_a", "worker", "bot_a", "worker", "t0", "t0");
    old.close();

    const store = await TaskStore.open(home);
    const listed = store.list("ses_board" as SessionId);
    expect(listed.map((item) => item.title)).toEqual(["예전 일"]);
    expect(listed[0]?.parentId).toBeNull();
    const child = store.create({
      boardId: "ses_board" as SessionId,
      parentId: "task_old",
      title: "새 조각",
      ownerId: "bot_a" as BotId,
      ownerHandle: "worker",
      requesterId: "bot_a",
      requesterHandle: "worker",
    });
    expect(child.parentId).toBe("task_old");
    store.close();
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

    const job = JSON.parse(
      await tool.execute({ action: "add", title: "큰 일" }, { workspace: home, approvalMode: "allow" }),
    ) as { task: { id: string } };
    const piece = JSON.parse(
      await tool.execute({ action: "add", title: "조각", parent: job.task.id, owner: "writer" }, {
        workspace: home,
        approvalMode: "allow",
      }),
    ) as { ok: boolean; task: { parentId: string | null } };
    expect(piece.ok).toBe(true);
    expect(piece.task.parentId).toBe(job.task.id);

    const tooDeep = JSON.parse(
      await tool.execute({ action: "add", title: "더", parent: (piece as never as { task: { id: string } }).task.id }, {
        workspace: home,
        approvalMode: "allow",
      }),
    ) as { ok: boolean; error?: string };
    expect(tooDeep.ok).toBe(false);
    expect(tooDeep.error).toContain("one level deep");
    sessions.close();
  });
});
