import {
  compactSession,
  deriveMessages,
  historyTokens,
  loadConfig,
  loadSecrets,
  resolveLlmEndpoint,
  type LlmClient,
  type SessionStore,
} from "@cbot/agent";
import {
  idleCompactReady,
  lastActivityMs,
  listBots,
  loadBot,
  maxEventSeq,
  type BotRecord,
} from "@cbot/bot";
import type { SessionId } from "@cbot/shared";

export interface IdleCompactRuntime {
  env: { home: string };
  store: SessionStore;
  llm: LlmClient;
}

/** Sessions that met idle+compactAt while busy; flush once when the turn ends. */
const pendingIdleCompact = new Set<string>();
/** Last seq we already attempted idle compact for, so we do not loop on nothing_to_compact. */
const attemptedAtSeq = new Map<string, number>();
const runningIdleCompact = new Set<string>();

const TICK_MS = 5_000;

export function startIdleCompactWatcher(
  runtime: IdleCompactRuntime,
  isBusy: (sessionId: SessionId) => boolean,
): () => void {
  const timer = setInterval(() => {
    void tickIdleCompact(runtime, isBusy);
  }, TICK_MS);
  // Do not keep the process alive solely for this timer in tests.
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Called when a session leaves the busy set so a deferred idle compact can run once. */
export function flushPendingIdleCompact(
  runtime: IdleCompactRuntime,
  sessionId: SessionId,
  isBusy: (sessionId: SessionId) => boolean,
): void {
  if (!pendingIdleCompact.has(sessionId)) {
    return;
  }
  // Idle already elapsed when pending was armed; do not wait another idle window
  // after the turn/approval that blocked the compact.
  void runIdleCompactForSession(runtime, sessionId, isBusy, Date.now(), true);
}

export async function tickIdleCompact(
  runtime: IdleCompactRuntime,
  isBusy: (sessionId: SessionId) => boolean,
  nowMs = Date.now(),
): Promise<void> {
  const bots = await listBots(runtime.env.home);
  for (const bot of bots) {
    if (!bot.autoCompactIdle) {
      continue;
    }
    for (const sessionId of sessionsOwnedByBot(runtime.store, bot)) {
      await considerIdleCompact(runtime, sessionId, bot, isBusy, nowMs);
    }
  }
}

function sessionsOwnedByBot(store: SessionStore, bot: BotRecord): SessionId[] {
  if (bot.role === "leader") {
    // Leader settings apply to coding sessions (the user-facing lead chat).
    return store.list({ kind: "coding" }).map((session) => session.id);
  }
  // Specialists: only their bot-chat sessions (canonical + per-coding hops).
  return store.list({ kind: "bot-chat", botId: bot.id }).map((session) => session.id);
}

async function considerIdleCompact(
  runtime: IdleCompactRuntime,
  sessionId: SessionId,
  bot: BotRecord,
  isBusy: (sessionId: SessionId) => boolean,
  nowMs: number,
): Promise<void> {
  if (!runtime.store.get(sessionId)) {
    return;
  }
  const events = runtime.store.events(sessionId);
  const seq = maxEventSeq(events);
  if (attemptedAtSeq.get(sessionId) === seq) {
    return;
  }
  const config = await loadConfig(runtime.env.home);
  const tokens = historyTokens(deriveMessages(events));
  const ready = idleCompactReady({
    enabled: bot.autoCompactIdle,
    idleMs: bot.autoCompactIdleMs,
    lastActivityMs: lastActivityMs(events, nowMs),
    nowMs,
    tokens,
    maxTokens: config.context.maxTokens,
    compactAt: config.context.compactAt,
  });
  if (!ready) {
    pendingIdleCompact.delete(sessionId);
    return;
  }
  if (isBusy(sessionId)) {
    pendingIdleCompact.add(sessionId);
    return;
  }
  await runIdleCompactForSession(runtime, sessionId, isBusy, nowMs);
}

async function runIdleCompactForSession(
  runtime: IdleCompactRuntime,
  sessionId: SessionId,
  isBusy: (sessionId: SessionId) => boolean,
  nowMs: number,
  /** True when flushing a deferred compact: wall-clock idle already passed. */
  idleAlreadySatisfied = false,
): Promise<void> {
  if (runningIdleCompact.has(sessionId) || isBusy(sessionId)) {
    pendingIdleCompact.add(sessionId);
    return;
  }
  const session = runtime.store.get(sessionId);
  if (!session) {
    pendingIdleCompact.delete(sessionId);
    return;
  }
  const bots = await listBots(runtime.env.home);
  const leader = bots.find((bot) => bot.role === "leader");
  const botId =
    session.kind === "coding" ? leader?.id : session.kind === "bot-chat" ? session.botId : null;
  if (!botId) {
    pendingIdleCompact.delete(sessionId);
    return;
  }
  const bot = await loadBot(runtime.env.home, botId);
  if (!bot?.autoCompactIdle) {
    pendingIdleCompact.delete(sessionId);
    return;
  }
  const events = runtime.store.events(sessionId);
  const seq = maxEventSeq(events);
  const config = await loadConfig(runtime.env.home);
  const tokens = historyTokens(deriveMessages(events));
  const overThreshold = tokens >= config.context.maxTokens * config.context.compactAt;
  const ready = idleAlreadySatisfied
    ? overThreshold
    : idleCompactReady({
        enabled: true,
        idleMs: bot.autoCompactIdleMs,
        lastActivityMs: lastActivityMs(events, nowMs),
        nowMs,
        tokens,
        maxTokens: config.context.maxTokens,
        compactAt: config.context.compactAt,
      });
  if (!ready) {
    pendingIdleCompact.delete(sessionId);
    return;
  }
  runningIdleCompact.add(sessionId);
  pendingIdleCompact.delete(sessionId);
  attemptedAtSeq.set(sessionId, seq);
  try {
    const secrets = await loadSecrets(runtime.env.home);
    const endpoint = resolveLlmEndpoint(config, secrets, {
      provider: bot.provider,
      model: bot.model,
    });
    // Same summary boundary as `/compact` (keepRecentTurns: 0); `auto: true` marks the event.
    await compactSession(sessionId, {
      store: runtime.store,
      llm: runtime.llm,
      apiKey: endpoint?.apiKey,
      baseURL: endpoint?.baseURL ?? "",
      model: endpoint?.model ?? "",
      keepRecentTurns: 0,
      auto: true,
    });
  } finally {
    runningIdleCompact.delete(sessionId);
  }
}

/** Test helper: clear deferred / attempted state between cases. */
export function resetIdleCompactState(): void {
  pendingIdleCompact.clear();
  attemptedAtSeq.clear();
  runningIdleCompact.clear();
}
