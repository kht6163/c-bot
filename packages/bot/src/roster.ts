import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { asBotId, asSessionId, newBotId, type BotId, type SessionId } from "@cbot/shared";
import type { SessionStore } from "@cbot/agent";
import {
  BOT_CHAT_TITLE,
  LEADER_HANDLE,
  type BotProfile,
  type BotRecord,
  type BotRole,
} from "./types.ts";

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
  return out.sort((a, b) => {
    if (a.role === "leader" && b.role !== "leader") {
      return -1;
    }
    if (b.role === "leader" && a.role !== "leader") {
      return 1;
    }
    return a.handle.localeCompare(b.handle);
  });
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

export async function findLeader(home: string): Promise<BotRecord | undefined> {
  return (await listBots(home)).find((bot) => bot.role === "leader");
}

export async function ensureLeaderBot(home: string, store: SessionStore): Promise<BotProfile> {
  const existing = await listBots(home);
  const leader = existing.find((bot) => bot.role === "leader") ?? existing.find((bot) => bot.handle === LEADER_HANDLE);
  if (leader) {
    if (leader.role !== "leader") {
      await writeRecord(home, { ...leader, role: "leader", handle: LEADER_HANDLE });
    }
    const loaded = await loadBot(home, leader.id);
    if (loaded) {
      return loaded;
    }
  }
  return createBot(home, store, {
    handle: LEADER_HANDLE,
    title: "Leader",
    description: "고정 리드. 사용자와 대화하고 전문 봇을 부릅니다.",
    role: "leader",
    soul: defaultLeaderSoul(),
  });
}

export async function createBot(
  home: string,
  store: SessionStore,
  input: {
    handle: string;
    title: string;
    description: string;
    soul?: string;
    workspace?: string | null;
    provider?: string | null;
    model?: string | null;
    thinking?: string | null;
    role?: BotRole;
  },
): Promise<BotProfile> {
  const handle = validateHandle(input.handle);
  const role: BotRole = input.role === "leader" ? "leader" : "specialist";
  if (role === "leader" && handle !== LEADER_HANDLE) {
    throw new Error("leader handle must be leader");
  }
  const existing = await listBots(home);
  if (role !== "leader" && handle === LEADER_HANDLE) {
    throw new Error("handle leader is reserved");
  }
  if (existing.some((bot) => bot.handle === handle)) {
    throw new Error("handle already exists");
  }
  if (role === "leader" && existing.some((bot) => bot.role === "leader")) {
    throw new Error("leader already exists");
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
    role,
    provider: input.provider?.trim() || null,
    model: input.model?.trim() || null,
    thinking: input.thinking?.trim() || null,
    hidden: false,
    sessionId: session.id,
  };
  const dir = join(botsDir(home), id);
  await mkdir(join(dir, "memory"), { recursive: true });
  await mkdir(join(dir, "skills"), { recursive: true });
  await Bun.write(join(dir, "profile.yaml"), serializeProfile(record));
  const soul = input.soul?.trim() ?? (role === "leader" ? defaultLeaderSoul() : defaultSoul(record));
  await Bun.write(join(dir, "SOUL.md"), soul.endsWith("\n") ? soul : `${soul}\n`);
  return { ...record, soul };
}

export async function updateBot(
  home: string,
  id: BotId,
  patch: {
    title?: string;
    description?: string;
    soul?: string;
    provider?: string | null;
    model?: string | null;
    thinking?: string | null;
  },
): Promise<BotProfile | undefined> {
  const loaded = await loadBot(home, id);
  if (!loaded) {
    return undefined;
  }
  const record: BotRecord = {
    id: loaded.id,
    handle: loaded.handle,
    title: patch.title !== undefined ? patch.title.trim() || loaded.handle : loaded.title,
    description: patch.description !== undefined ? patch.description.trim() : loaded.description,
    role: loaded.role,
    provider: patch.provider !== undefined ? patch.provider?.trim() || null : loaded.provider,
    model: patch.model !== undefined ? patch.model?.trim() || null : loaded.model,
    thinking: patch.thinking !== undefined ? patch.thinking?.trim() || null : loaded.thinking,
    hidden: loaded.hidden,
    sessionId: loaded.sessionId,
  };
  await writeRecord(home, record);
  const soul = patch.soul !== undefined ? patch.soul : loaded.soul;
  const text = soul.endsWith("\n") ? soul : `${soul}\n`;
  await Bun.write(join(botsDir(home), id, "SOUL.md"), text);
  return { ...record, soul: text };
}

export async function deleteBot(home: string, id: BotId): Promise<boolean> {
  const loaded = await loadBot(home, id);
  if (!loaded) {
    return false;
  }
  if (loaded.role === "leader") {
    throw new Error("leader cannot be deleted");
  }
  await rm(join(botsDir(home), id), { recursive: true, force: true });
  return true;
}

export function findBotChat(store: SessionStore, botId: BotId): SessionId | undefined {
  return store.list({ kind: "bot-chat", botId, parentId: null })[0]?.id;
}

async function writeRecord(home: string, record: BotRecord): Promise<void> {
  const dir = join(botsDir(home), record.id);
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, "profile.yaml"), serializeProfile(record));
}

function defaultLeaderSoul(): string {
  return [
    "# Leader",
    "",
    "You are the lead coding agent. Talk to the user. Do the work yourself when you can.",
    "When a specialist is a better fit, call `message_agent` with their handle.",
    "The user cannot open other bots' chats. You are the only one who talks to them.",
    "",
  ].join("\n");
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
    `role: ${record.role}`,
    `provider: ${record.provider ? JSON.stringify(record.provider) : "null"}`,
    `model: ${record.model ? JSON.stringify(record.model) : "null"}`,
    `thinking: ${record.thinking ? JSON.stringify(record.thinking) : "null"}`,
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
  const handle = parsed.handle;
  const role: BotRole =
    parsed.role === "leader" || handle === LEADER_HANDLE ? "leader" : "specialist";
  return {
    id: asBotId(parsed.id),
    handle,
    title: typeof parsed.title === "string" ? parsed.title : parsed.handle,
    description: typeof parsed.description === "string" ? parsed.description : "",
    role,
    provider: typeof parsed.provider === "string" ? parsed.provider : null,
    model: typeof parsed.model === "string" ? parsed.model : null,
    thinking: typeof parsed.thinking === "string" && parsed.thinking.trim() ? parsed.thinking.trim() : null,
    hidden: parsed.hidden === true,
    sessionId: asSessionId(parsed.sessionId),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
