import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { newId, type BotId, type SessionId, type TaskStatus } from "@cbot/shared";
import type { SessionStore } from "@cbot/agent";

export const TASK_TITLE_MAX = 200;
export const TASK_DETAIL_MAX = 2000;

export interface TaskEntry {
  id: string;
  boardId: SessionId;
  title: string;
  detail: string;
  status: TaskStatus;
  ownerId: BotId;
  ownerHandle: string;
  requesterId: string;
  requesterHandle: string;
  createdAt: string;
  updatedAt: string;
}

const STATUSES = new Set<TaskStatus>(["pending", "in_progress", "completed", "cancelled"]);

export function tasksDbPath(home: string): string {
  return join(home, "tasks", "tasks.sqlite");
}

export function taskBoardId(store: SessionStore, sessionId: SessionId): SessionId {
  const session = store.get(sessionId);
  return session?.parentId ?? sessionId;
}

export class TaskStore {
  private constructor(private readonly db: Database) {}

  static async open(home: string): Promise<TaskStore> {
    const path = tasksDbPath(home);
    await mkdir(join(home, "tasks"), { recursive: true });
    const db = new Database(path);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
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
      CREATE INDEX IF NOT EXISTS tasks_board ON tasks(board_id, updated_at);
    `);
    return new TaskStore(db);
  }

  close(): void {
    this.db.close();
  }

  list(
    boardId: SessionId,
    filter: { ownerHandle?: string; requesterHandle?: string; status?: TaskStatus } = {},
  ): TaskEntry[] {
    const rows = this.db
      .query(
        `SELECT id, board_id AS boardId, title, detail, status,
                owner_id AS ownerId, owner_handle AS ownerHandle,
                requester_id AS requesterId, requester_handle AS requesterHandle,
                created_at AS createdAt, updated_at AS updatedAt
         FROM tasks WHERE board_id = ? ORDER BY updated_at DESC`,
      )
      .all(boardId) as TaskEntry[];
    return rows.filter((row) => {
      if (filter.ownerHandle && row.ownerHandle !== filter.ownerHandle) {
        return false;
      }
      if (filter.requesterHandle && row.requesterHandle !== filter.requesterHandle) {
        return false;
      }
      if (filter.status && row.status !== filter.status) {
        return false;
      }
      return true;
    });
  }

  get(id: string): TaskEntry | undefined {
    return this.db
      .query(
        `SELECT id, board_id AS boardId, title, detail, status,
                owner_id AS ownerId, owner_handle AS ownerHandle,
                requester_id AS requesterId, requester_handle AS requesterHandle,
                created_at AS createdAt, updated_at AS updatedAt
         FROM tasks WHERE id = ?`,
      )
      .get(id) as TaskEntry | undefined;
  }

  create(input: {
    boardId: SessionId;
    title: string;
    detail?: string;
    status?: TaskStatus;
    ownerId: BotId;
    ownerHandle: string;
    requesterId: string;
    requesterHandle: string;
  }): TaskEntry {
    const title = clip(input.title, TASK_TITLE_MAX);
    if (title.length === 0) {
      throw new Error("task title required");
    }
    const now = new Date().toISOString();
    const id = newId("task");
    const status = parseStatus(input.status) ?? "pending";
    this.db
      .query(
        `INSERT INTO tasks (
           id, board_id, title, detail, status, owner_id, owner_handle,
           requester_id, requester_handle, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.boardId,
        title,
        clip(input.detail ?? "", TASK_DETAIL_MAX),
        status,
        input.ownerId,
        input.ownerHandle,
        input.requesterId,
        input.requesterHandle,
        now,
        now,
      );
    return this.get(id) as TaskEntry;
  }

  /** boardId scopes the write: a bot can only touch its own session board. */
  update(
    id: string,
    boardId: SessionId,
    patch: { title?: string; detail?: string; status?: TaskStatus; ownerId?: BotId; ownerHandle?: string },
  ): TaskEntry | undefined {
    const current = this.get(id);
    if (!current || current.boardId !== boardId) {
      return undefined;
    }
    const title = patch.title !== undefined ? clip(patch.title, TASK_TITLE_MAX) : current.title;
    if (title.length === 0) {
      throw new Error("task title required");
    }
    const detail = patch.detail !== undefined ? clip(patch.detail, TASK_DETAIL_MAX) : current.detail;
    const status = patch.status !== undefined ? (parseStatus(patch.status) ?? current.status) : current.status;
    const ownerId = patch.ownerId ?? current.ownerId;
    const ownerHandle = patch.ownerHandle ?? current.ownerHandle;
    const now = new Date().toISOString();
    this.db
      .query(
        `UPDATE tasks SET title = ?, detail = ?, status = ?, owner_id = ?, owner_handle = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(title, detail, status, ownerId, ownerHandle, now, id);
    return this.get(id);
  }
}

function parseStatus(value: string | undefined): TaskStatus | undefined {
  if (!value) {
    return undefined;
  }
  return STATUSES.has(value as TaskStatus) ? (value as TaskStatus) : undefined;
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}
