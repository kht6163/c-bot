import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { newId, type BotId } from "@cbot/shared";
import { cjkMatchQuery, cjkSearchText } from "./cjk-tokenize.ts";

export const MEMORY_TITLE_MAX = 120;
export const MEMORY_CUE_MAX = 400;
export const MEMORY_BODY_MAX = 8000;
export const MEMORY_SEARCH_LIMIT = 8;

const MEMORY_COLUMNS = `id, title, cue, body, created_at AS createdAt, updated_at AS updatedAt`;

export interface MemoryEntry {
  id: string;
  title: string;
  cue: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryHit extends MemoryEntry {
  rank: number;
}

export function memoryDbPath(home: string, botId: BotId): string {
  return join(home, "bots", botId, "memory", "memory.sqlite");
}

/** Title + when-to-use cue are the search surface. Body is indexed only if cue is empty. */
export function memorySearchSource(title: string, cue: string, body: string): string {
  const source = cue.length > 0 ? `${title}\n${cue}` : `${title}\n${body}`;
  return cjkSearchText(source);
}

export class MemoryStore {
  private constructor(private readonly db: Database) {}

  static async open(home: string, botId: BotId): Promise<MemoryStore> {
    const path = memoryDbPath(home, botId);
    await mkdir(join(home, "bots", botId, "memory"), { recursive: true });
    const db = new Database(path);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        cue TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        search TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        search,
        content='memories',
        content_rowid='rowid',
        tokenize='unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, search) VALUES (new.rowid, new.search);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, search) VALUES('delete', old.rowid, old.search);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, search) VALUES('delete', old.rowid, old.search);
        INSERT INTO memories_fts(rowid, search) VALUES (new.rowid, new.search);
      END;
    `);
    ensureCueColumn(db);
    return new MemoryStore(db);
  }

  close(): void {
    this.db.close();
  }

  list(): MemoryEntry[] {
    const rows = this.db
      .query(
        `SELECT ${MEMORY_COLUMNS}
         FROM memories ORDER BY updated_at DESC`,
      )
      .all() as MemoryEntry[];
    return rows;
  }

  get(id: string): MemoryEntry | undefined {
    return this.db
      .query(
        `SELECT ${MEMORY_COLUMNS}
         FROM memories WHERE id = ?`,
      )
      .get(id) as MemoryEntry | undefined;
  }

  create(input: { title: string; cue?: string; body: string }): MemoryEntry {
    const title = clip(input.title, MEMORY_TITLE_MAX);
    const cue = clip(input.cue ?? "", MEMORY_CUE_MAX);
    const body = clip(input.body, MEMORY_BODY_MAX);
    if (title.length === 0 && body.length === 0) {
      throw new Error("memory is empty");
    }
    const now = new Date().toISOString();
    const id = newId("mem");
    const storedTitle = title || body.slice(0, 40);
    this.db
      .query(
        `INSERT INTO memories (id, title, cue, body, search, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, storedTitle, cue, body, memorySearchSource(storedTitle, cue, body), now, now);
    return this.get(id) as MemoryEntry;
  }

  update(
    id: string,
    patch: { title?: string; cue?: string; body?: string },
  ): MemoryEntry | undefined {
    const current = this.get(id);
    if (!current) {
      return undefined;
    }
    const title = patch.title !== undefined ? clip(patch.title, MEMORY_TITLE_MAX) : current.title;
    const cue = patch.cue !== undefined ? clip(patch.cue, MEMORY_CUE_MAX) : current.cue;
    const body = patch.body !== undefined ? clip(patch.body, MEMORY_BODY_MAX) : current.body;
    if (title.length === 0 && body.length === 0) {
      throw new Error("memory is empty");
    }
    const now = new Date().toISOString();
    const storedTitle = title || body.slice(0, 40);
    this.db
      .query(
        `UPDATE memories SET title = ?, cue = ?, body = ?, search = ?, updated_at = ? WHERE id = ?`,
      )
      .run(storedTitle, cue, body, memorySearchSource(storedTitle, cue, body), now, id);
    return this.get(id);
  }

  remove(id: string): boolean {
    const result = this.db.query(`DELETE FROM memories WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  search(query: string, limit = MEMORY_SEARCH_LIMIT): MemoryHit[] {
    const match = cjkMatchQuery(query);
    if (!match) {
      return this.list()
        .slice(0, limit)
        .map((item) => ({ ...item, rank: 0 }));
    }
    try {
      const rows = this.db
        .query(
          `SELECT m.id, m.title, m.cue, m.body, m.created_at AS createdAt, m.updated_at AS updatedAt,
                  bm25(memories_fts) AS rank
           FROM memories_fts
           JOIN memories m ON m.rowid = memories_fts.rowid
           WHERE memories_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(match, limit) as MemoryHit[];
      return rows;
    } catch {
      return [];
    }
  }
}

function ensureCueColumn(db: Database): void {
  const cols = db.query(`PRAGMA table_info(memories)`).all() as { name: string }[];
  if (cols.some((col) => col.name === "cue")) {
    return;
  }
  db.exec(`ALTER TABLE memories ADD COLUMN cue TEXT NOT NULL DEFAULT ''`);
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}
