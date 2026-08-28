import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SessionStore, deriveMessages } from "@cbot/agent";
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

describe("TaskStore remove", () => {
  test("a job takes its pieces with it, and only on its own board", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-tasks-"));
    const sessions = await SessionStore.open(":memory:");
    const board = sessions.create({ kind: "coding", workspace: home });
    const other = sessions.create({ kind: "coding", workspace: home });
    const bot = await createBot(home, sessions, { handle: "worker", title: "W", description: "W" });
    const store = await TaskStore.open(home);
    const who = { ownerId: bot.id, ownerHandle: bot.handle, requesterId: bot.id, requesterHandle: bot.handle };

    const job = store.create({ boardId: board.id, title: "일", ...who });
    store.create({ boardId: board.id, parentId: job.id, title: "조각1", ...who });
    store.create({ boardId: board.id, parentId: job.id, title: "조각2", ...who });
    const keep = store.create({ boardId: board.id, title: "남길 일", ...who });
    const outsider = store.create({ boardId: other.id, title: "남의 일", ...who });

    expect(store.remove(outsider.id, board.id)).toEqual([]);
    expect(store.get(outsider.id)?.title).toBe("남의 일");
    expect(store.remove("task_nope", board.id)).toEqual([]);

    const gone = store.remove(job.id, board.id);
    expect(gone.map((item) => item.title).sort()).toEqual(["일", "조각1", "조각2"]);
    expect(store.get(job.id)).toBeUndefined();
    expect(store.children(job.id)).toEqual([]);
    expect(store.list(board.id).map((item) => item.title)).toEqual(["남길 일"]);
    expect(store.get(keep.id)?.title).toBe("남길 일");

    expect(store.remove(job.id, board.id)).toEqual([]);
    store.close();
    sessions.close();
  });

  test("removing a piece leaves its job standing", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-tasks-"));
    const sessions = await SessionStore.open(":memory:");
    const board = sessions.create({ kind: "coding", workspace: home });
    const bot = await createBot(home, sessions, { handle: "worker", title: "W", description: "W" });
    const store = await TaskStore.open(home);
    const who = { ownerId: bot.id, ownerHandle: bot.handle, requesterId: bot.id, requesterHandle: bot.handle };
    const job = store.create({ boardId: board.id, title: "일", ...who });
    const piece = store.create({ boardId: board.id, parentId: job.id, title: "조각", ...who });
    expect(store.remove(piece.id, board.id).map((item) => item.title)).toEqual(["조각"]);
    expect(store.get(job.id)?.title).toBe("일");
    expect(store.children(job.id)).toEqual([]);
    store.close();
    sessions.close();
  });
});

describe("taskTool remove guard", () => {
  test("refuses to take unfinished pieces until asked twice", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-tasks-"));
    const sessions = await SessionStore.open(":memory:");
    const coding = sessions.create({ kind: "coding", workspace: home });
    const lead = await createBot(home, sessions, { handle: "leaderx", title: "L", description: "L" });
    const tool = taskTool({ home, store: sessions, sessionId: coding.id, actor: lead, roster: [lead] });
    const run = async (args: Record<string, unknown>) =>
      JSON.parse(await tool.execute(args, { workspace: home, approvalMode: "allow" })) as {
        ok: boolean;
        error?: string;
        removed?: number;
        subtasks?: { title: string }[];
        task?: { id: string };
      };

    const job = await run({ action: "add", title: "인증 리팩터", status: "completed" });
    const jobId = job.task?.id ?? "";
    await run({ action: "add", title: "토큰 만료", parent: jobId, status: "completed" });
    await run({ action: "add", title: "세션 갱신", parent: jobId, status: "pending" });

    const refused = await run({ action: "remove", id: jobId });
    expect(refused.ok).toBe(false);
    expect(refused.error).toBe("job has unfinished pieces");
    expect(refused.subtasks?.map((item) => item.title)).toEqual(["세션 갱신"]);
    const still = await run({ action: "list" });
    expect((still as unknown as { tasks: unknown[] }).tasks).toHaveLength(3);

    const done = await run({ action: "remove", id: jobId, cascade: true });
    expect(done.ok).toBe(true);
    expect(done.removed).toBe(3);
    sessions.close();
  });

  test("a job whose pieces are all finished needs no cascade", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-tasks-"));
    const sessions = await SessionStore.open(":memory:");
    const coding = sessions.create({ kind: "coding", workspace: home });
    const lead = await createBot(home, sessions, { handle: "leaderx", title: "L", description: "L" });
    const tool = taskTool({ home, store: sessions, sessionId: coding.id, actor: lead, roster: [lead] });
    const run = async (args: Record<string, unknown>) =>
      JSON.parse(await tool.execute(args, { workspace: home, approvalMode: "allow" })) as {
        ok: boolean;
        removed?: number;
        task?: { id: string };
      };
    const job = await run({ action: "add", title: "일", status: "completed" });
    const jobId = job.task?.id ?? "";
    await run({ action: "add", title: "조각", parent: jobId, status: "cancelled" });
    const done = await run({ action: "remove", id: jobId });
    expect(done.ok).toBe(true);
    expect(done.removed).toBe(2);
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

    const refused = JSON.parse(
      await tool.execute({ action: "remove", id: job.task.id }, { workspace: home, approvalMode: "allow" }),
    ) as { ok: boolean; error?: string };
    expect(refused.ok).toBe(false);
    expect(refused.error).toBe("job has unfinished pieces");
    const removed = JSON.parse(
      await tool.execute({ action: "remove", id: job.task.id, cascade: true }, {
        workspace: home,
        approvalMode: "allow",
      }),
    ) as { ok: boolean; removed: number };
    expect(removed.ok).toBe(true);
    expect(removed.removed).toBe(2);
    const afterRemove = JSON.parse(
      await tool.execute({ action: "list" }, { workspace: home, approvalMode: "allow" }),
    ) as { tasks: { title: string }[] };
    expect(afterRemove.tasks.map((item) => item.title)).not.toContain("큰 일");
    expect(afterRemove.tasks.map((item) => item.title)).not.toContain("조각");
    const missing = JSON.parse(
      await tool.execute({ action: "remove", id: job.task.id }, { workspace: home, approvalMode: "allow" }),
    ) as { ok: boolean; error?: string };
    expect(missing.ok).toBe(false);
    expect(missing.error).toBe("unknown task");
    const removeEvents = sessions
      .events(coding.id)
      .filter((event) => event.type === "task/change" && event.action === "remove");
    expect(removeEvents).toHaveLength(2);
    expect(deriveMessages(sessions.events(coding.id)).some((m) => JSON.stringify(m).includes("큰 일"))).toBe(
      false,
    );

    sessions.close();
  });
});
