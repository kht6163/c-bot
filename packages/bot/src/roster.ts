import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { asBotId, asSessionId, newBotId, type BotId, type SessionId } from "@cbot/shared";
import type { SessionStore } from "@cbot/agent";
import { BOT_CHAT_TITLE, type BotProfile, type BotRecord } from "./types.ts";

const HANDLE_RE = /^[a-z][a-z0-9-]{0,31}$/;

export function botsDir(home: string): string {
  return join(home, "bots");
}

export function validateHandle(handle: string): string {
  const normalized = handle.trim().toLowerCase();
  if (!HANDLE_RE.test(normalized)) {
    throw new Error("handle must be lowercase letters, digits, and hyphen");
  }
  return normalized;
}

export async function listBots(home: string): Promise<BotRecord[]> {
  const root = botsDir(home);
  await mkdir(root, { recursive: true });
  const glob = new Bun.Glob("*/profile.yaml");
  const out: BotRecord[] = [];
  for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
    const raw = await Bun.file(join(root, rel)).text();
    const parsed = parseProfileYaml(raw);
    if (parsed) {
      out.push(parsed);
    }
  }
  return out.sort((a, b) => a.handle.localeCompare(b.handle));
}

export async function loadBot(home: string, id: BotId): Promise<BotProfile | undefined> {
  const dir = join(botsDir(home), id);
  const file = Bun.file(join(dir, "profile.yaml"));
  if (!(await file.exists())) {
    return undefined;
  }
  const record = parseProfileYaml(await file.text());
  if (!record) {
    return undefined;
  }
  const soulFile = Bun.file(join(dir, "SOUL.md"));
  const soul = (await soulFile.exists()) ? await soulFile.text() : "";
  return { ...record, soul };
}

export async function createBot(
  home: string,
  store: SessionStore,
  input: { handle: string; title: string; description: string; soul?: string; workspace?: string | null },
): Promise<BotProfile> {
  const handle = validateHandle(input.handle);
  const existing = await listBots(home);
  if (existing.some((bot) => bot.handle === handle)) {
    throw new Error("handle already exists");
  }
  const id = newBotId();
  const session = store.create({
    kind: "bot-chat",
    title: BOT_CHAT_TITLE,
    botId: id,
    workspace: input.workspace ?? null,
  });
  const record: BotRecord = {
    id,
    handle,
    title: input.title.trim() || handle,
    description: input.description.trim(),
    model: null,
    hidden: false,
    sessionId: session.id,
  };
  const dir = join(botsDir(home), id);
  await mkdir(join(dir, "memory"), { recursive: true });
  await mkdir(join(dir, "skills"), { recursive: true });
  await Bun.write(join(dir, "profile.yaml"), serializeProfile(record));
  const soul = input.soul?.trim() ?? defaultSoul(record);
  await Bun.write(join(dir, "SOUL.md"), soul.endsWith("\n") ? soul : `${soul}\n`);
  return { ...record, soul };
}

export function findBotChat(store: SessionStore, botId: BotId): SessionId | undefined {
  return store.list().find((s) => s.kind === "bot-chat" && s.botId === botId)?.id;
}

function defaultSoul(record: BotRecord): string {
  return `# ${record.title}\n\n${record.description || `You are @${record.handle}.`}\n`;
}

function serializeProfile(record: BotRecord): string {
  return [
    `id: ${JSON.stringify(record.id)}`,
    `handle: ${JSON.stringify(record.handle)}`,
    `title: ${JSON.stringify(record.title)}`,
    `description: ${JSON.stringify(record.description)}`,
    `model: ${record.model ? JSON.stringify(record.model) : "null"}`,
    `hidden: ${record.hidden}`,
    `sessionId: ${JSON.stringify(record.sessionId)}`,
    "",
  ].join("\n");
}

function parseProfileYaml(raw: string): BotRecord | undefined {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  if (typeof parsed.id !== "string" || typeof parsed.handle !== "string") {
    return undefined;
  }
  if (typeof parsed.sessionId !== "string") {
    return undefined;
  }
  return {
    id: asBotId(parsed.id),
    handle: parsed.handle,
    title: typeof parsed.title === "string" ? parsed.title : parsed.handle,
    description: typeof parsed.description === "string" ? parsed.description : "",
    model: typeof parsed.model === "string" ? parsed.model : null,
    hidden: parsed.hidden === true,
    sessionId: asSessionId(parsed.sessionId),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
