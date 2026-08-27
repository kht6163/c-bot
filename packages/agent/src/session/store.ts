import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import {
  SESSION_FORMAT_VERSION,
  asBotId,
  asSessionId,
  newSessionId,
  type BotId,
  type SessionEvent,
  type SessionId,
  type SessionKind,
  type SessionSummary,
} from "@cbot/shared";

export interface CreateSessionInput {
  kind?: SessionKind;
  title?: string;
  botId?: BotId | null;
  workspace?: string | null;
}

type AppendListener = (sessionId: SessionId, event: SessionEvent) => void;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export type SessionEventInput = DistributiveOmit<SessionEvent, "seq" | "time"> & {
  time?: string;
};

const EVENT_TYPES = new Set([
  "turn/start",
  "turn/end",
  "user/message",
  "assistant/chunk",
  "assistant/message",
  "tool/call",
  "tool/result",
  "bot/message",
  "bot/delivery",
]);

export class SessionStore {
  private readonly db: Database;
  private readonly listeners = new Set<AppendListener>();

  private constructor(db: Database) {
    this.db = db;
  }

  static async open(path: string): Promise<SessionStore> {
    if (path !== ":memory:") {
      await mkdir(dirname(path), { recursive: true });
    }
    const db = new Database(path);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        bot_id TEXT,
        workspace TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        time TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (session_id, seq),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
    `);
    const version = db
      .query("SELECT value FROM meta WHERE key = 'format_version'")
      .get() as { value: string } | null;
    if (!version) {
      db.query("INSERT INTO meta (key, value) VALUES ('format_version', ?)").run(
        String(SESSION_FORMAT_VERSION),
      );
    } else if (Number(version.value) > SESSION_FORMAT_VERSION) {
      db.close();
      throw new Error(
        `sessions database format ${version.value} is newer than ${SESSION_FORMAT_VERSION}`,
      );
    }
    return new SessionStore(db);
  }

  close(): void {
    this.db.close();
  }

  onAppend(listener: AppendListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  create(input: CreateSessionInput = {}): SessionSummary {
    const now = new Date().toISOString();
    const summary: SessionSummary = {
      id: newSessionId(),
      title: input.title?.trim() || "새 세션",
      kind: input.kind ?? "coding",
      botId: input.botId ?? null,
      workspace: input.workspace ?? null,
      updatedAt: now,
    };
    this.db
      .query(
        `INSERT INTO sessions (id, title, kind, bot_id, workspace, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        summary.id,
        summary.title,
        summary.kind,
        summary.botId,
        summary.workspace,
        now,
        now,
      );
    return summary;
  }

  get(id: SessionId): SessionSummary | undefined {
    const row = this.db
      .query(
        `SELECT id, title, kind, bot_id, workspace, updated_at
         FROM sessions WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          title: string;
          kind: SessionKind;
          bot_id: string | null;
          workspace: string | null;
          updated_at: string;
        }
      | null;
    return row ? toSummary(row) : undefined;
  }

  list(filter?: { kind?: SessionKind; workspace?: string }): SessionSummary[] {
    const rows = this.db
      .query(
        `SELECT id, title, kind, bot_id, workspace, updated_at
         FROM sessions ORDER BY updated_at DESC`,
      )
      .all() as {
      id: string;
      title: string;
      kind: SessionKind;
      bot_id: string | null;
      workspace: string | null;
      updated_at: string;
    }[];
    return rows
      .map(toSummary)
      .filter((session) => {
        if (filter?.kind && session.kind !== filter.kind) {
          return false;
        }
        if (filter?.workspace !== undefined && session.workspace !== filter.workspace) {
          return false;
        }
        return true;
      });
  }

  setTitle(id: SessionId, title: string): void {
    const now = new Date().toISOString();
    this.db
      .query("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, now, id);
  }

  setWorkspace(id: SessionId, workspace: string | null): void {
    const now = new Date().toISOString();
    this.db
      .query("UPDATE sessions SET workspace = ?, updated_at = ? WHERE id = ?")
      .run(workspace, now, id);
  }

  events(id: SessionId): SessionEvent[] {
    const rows = this.db
      .query("SELECT payload FROM events WHERE session_id = ? ORDER BY seq ASC")
      .all(id) as { payload: string }[];
    return rows.map((row) => parseEvent(row.payload));
  }

  append(id: SessionId, event: SessionEventInput): SessionEvent {
    const session = this.get(id);
    if (!session) {
      throw new Error(`unknown session ${id}`);
    }
    const last = this.db
      .query("SELECT MAX(seq) AS seq FROM events WHERE session_id = ?")
      .get(id) as { seq: number | null };
    const seq = (last.seq ?? 0) + 1;
    const time = event.time ?? new Date().toISOString();
    const full = { ...event, seq, time } as SessionEvent;
    const now = time;
    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO events (session_id, seq, time, type, payload)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, seq, time, full.type, JSON.stringify(full));
      this.db.query("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, id);
    })();
    for (const listener of this.listeners) {
      listener(id, full);
    }
    return full;
  }
}

function toSummary(row: {
  id: string;
  title: string;
  kind: SessionKind;
  bot_id: string | null;
  workspace: string | null;
  updated_at: string;
}): SessionSummary {
  return {
    id: asSessionId(row.id),
    title: row.title,
    kind: row.kind,
    botId: row.bot_id ? asBotId(row.bot_id) : null,
    workspace: row.workspace,
    updatedAt: row.updated_at,
  };
}

function parseEvent(payload: string): SessionEvent {
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    throw new Error("corrupt session event JSON");
  }
  if (!isRecord(data) || typeof data.type !== "string" || !EVENT_TYPES.has(data.type)) {
    throw new Error("corrupt session event");
  }
  return data as unknown as SessionEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
