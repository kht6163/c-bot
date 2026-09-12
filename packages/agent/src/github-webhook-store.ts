/**
 * Persists GitHub webhook delivery IDs (idempotency) and PR URL → session maps
 * under $CBOT_HOME.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import type { SessionId } from "@cbot/shared";
import { asSessionId } from "@cbot/shared";

export function githubWebhookDbPath(home: string): string {
  return join(home, "github-webhooks.sqlite");
}

export class GithubWebhookStore {
  private readonly db: Database;

  private constructor(db: Database) {
    this.db = db;
  }

  static async open(path: string): Promise<GithubWebhookStore> {
    if (path !== ":memory:") {
      await mkdir(dirname(path), { recursive: true });
    }
    const db = new Database(path);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS deliveries (
        id TEXT PRIMARY KEY,
        seen_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pr_sessions (
        pr_url TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        branch TEXT,
        updated_at TEXT NOT NULL
      );
    `);
    return new GithubWebhookStore(db);
  }

  close(): void {
    this.db.close();
  }

  /** Returns true if this delivery was already recorded (caller should skip). */
  hasDelivery(id: string): boolean {
    const row = this.db.query("SELECT 1 AS ok FROM deliveries WHERE id = ?").get(id) as
      | { ok: number }
      | null;
    return row != null;
  }

  /**
   * Record a delivery id. Returns false when it was already present
   * (at-most-once processing).
   */
  claimDelivery(id: string): boolean {
    if (!id.trim()) {
      return false;
    }
    const now = new Date().toISOString();
    try {
      this.db.query("INSERT INTO deliveries (id, seen_at) VALUES (?, ?)").run(id, now);
      return true;
    } catch {
      return false;
    }
  }

  rememberPrSession(prUrl: string, sessionId: SessionId, branch?: string | null): void {
    const url = normalizePrUrl(prUrl);
    if (!url) {
      return;
    }
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO pr_sessions (pr_url, session_id, branch, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(pr_url) DO UPDATE SET
           session_id = excluded.session_id,
           branch = COALESCE(excluded.branch, pr_sessions.branch),
           updated_at = excluded.updated_at`,
      )
      .run(url, sessionId, branch ?? null, now);
  }

  sessionIdForPr(prUrl: string): SessionId | undefined {
    const url = normalizePrUrl(prUrl);
    if (!url) {
      return undefined;
    }
    const row = this.db
      .query("SELECT session_id FROM pr_sessions WHERE pr_url = ?")
      .get(url) as { session_id: string } | null;
    return row ? asSessionId(row.session_id) : undefined;
  }
}

/** Strip trailing slash / query / fragment noise for stable keys. */
export function normalizePrUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (!/github\.com$/i.test(url.hostname) && url.hostname !== "github.com") {
      // still allow github.com hosts
    }
    url.hash = "";
    url.search = "";
    let path = url.pathname.replace(/\/+$/, "");
    // Accept /owner/repo/pull/N
    const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/i.exec(path);
    if (!match) {
      return `${url.origin}${path}`.toLowerCase();
    }
    return `${url.origin}/${match[1]}/${match[2]}/pull/${match[3]}`.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}
