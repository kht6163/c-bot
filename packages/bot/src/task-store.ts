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
  parentId: string | null;
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
        parent_id TEXT,
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
    const columns = db.query("PRAGMA table_info(tasks)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "parent_id")) {
      db.exec("ALTER TABLE tasks ADD COLUMN parent_id TEXT");
    }
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
        `SELECT id, board_id AS boardId, parent_id AS parentId, title, detail, status,
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
    return (this.db
      .query(
        `SELECT id, board_id AS boardId, parent_id AS parentId, title, detail, status,
                owner_id AS ownerId, owner_handle AS ownerHandle,
                requester_id AS requesterId, requester_handle AS requesterHandle,
                created_at AS createdAt, updated_at AS updatedAt
         FROM tasks WHERE id = ?`,
      )
      // bun:sqlite hands back null for a miss; the signature says undefined.
      .get(id) as TaskEntry | null) ?? undefined;
  }

  create(input: {
    boardId: SessionId;
    parentId?: string | null;
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
    const parentId = this.parentFor(input.boardId, input.parentId);
    this.db
      .query(
        `INSERT INTO tasks (
           id, board_id, parent_id, title, detail, status, owner_id, owner_handle,
           requester_id, requester_handle, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.boardId,
        parentId,
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
    patch: {
      title?: string;
      detail?: string;
      status?: TaskStatus;
      ownerId?: BotId;
      ownerHandle?: string;
      parentId?: string | null;
    },
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
    const parentId =
      patch.parentId === undefined ? current.parentId : this.parentFor(boardId, patch.parentId, id);
    if (parentId && this.children(id).length > 0) {
      throw new Error("a task with subtasks cannot become a subtask");
    }
    const now = new Date().toISOString();
    this.db
      .query(
        `UPDATE tasks SET parent_id = ?, title = ?, detail = ?, status = ?, owner_id = ?,
           owner_handle = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(parentId, title, detail, status, ownerId, ownerHandle, now, id);
    return this.get(id);
  }

  /**
   * Removing a job removes its pieces with it: a piece is the breakdown of a
   * job, not work that outlives it. Returns the rows that were on the board,
   * so the caller can name what it erased.
   */
  remove(id: string, boardId: SessionId): TaskEntry[] {
    const current = this.get(id);
    if (!current || current.boardId !== boardId) {
      return [];
    }
    const gone = [current, ...this.children(id).filter((child) => child.boardId === boardId)];
    this.db.transaction(() => {
      this.db.query("DELETE FROM tasks WHERE parent_id = ? AND board_id = ?").run(id, boardId);
      this.db.query("DELETE FROM tasks WHERE id = ? AND board_id = ?").run(id, boardId);
    })();
    return gone;
  }

  children(id: string): TaskEntry[] {
    return this.db
      .query(
        `SELECT id, board_id AS boardId, parent_id AS parentId, title, detail, status,
                owner_id AS ownerId, owner_handle AS ownerHandle,
                requester_id AS requesterId, requester_handle AS requesterHandle,
                created_at AS createdAt, updated_at AS updatedAt
         FROM tasks WHERE parent_id = ? ORDER BY created_at ASC`,
      )
      .all(id) as TaskEntry[];
  }

  /**
   * The board is two levels deep on purpose: a job and its pieces. A parent
   * has to be a top-level task on the same board, so a subtask can never grow
   * subtasks of its own.
   */
  private parentFor(boardId: SessionId, parentId: string | null | undefined, selfId?: string): string | null {
    if (!parentId) {
      return null;
    }
    if (selfId && parentId === selfId) {
      throw new Error("a task cannot be its own parent");
    }
    const parent = this.get(parentId);
    if (!parent || parent.boardId !== boardId) {
      throw new Error("unknown parent task");
    }
    if (parent.parentId) {
      throw new Error("subtasks are one level deep");
    }
    return parent.id;
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
