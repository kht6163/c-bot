import {
  OpenAiCompatClient,
  SessionStore,
  ensureHome,
  loadConfig,
  loadSecrets,
  runTurn,
  sessionNeedsTurn,
  sessionsDbPath,
  titleFromText,
  type LlmClient,
} from "@cbot/agent";
import type { SessionId } from "@cbot/shared";
import type { ProcessEnv } from "./env.ts";
import { EventHub } from "./hub.ts";

export interface Runtime {
  env: ProcessEnv;
  store: SessionStore;
  hub: EventHub;
  llm: LlmClient;
}

const busy = new Set<string>();

export async function createRuntime(env: ProcessEnv, llm?: LlmClient): Promise<Runtime> {
  await ensureHome(env.home);
  const store = await SessionStore.open(sessionsDbPath(env.home));
  const hub = new EventHub();
  store.onAppend((sessionId, event) => {
    hub.emit(sessionId, event);
  });
  return { env, store, hub, llm: llm ?? new OpenAiCompatClient() };
}

export async function acceptUserMessage(
  runtime: Runtime,
  sessionId: SessionId,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error("empty message");
  }
  const session = runtime.store.get(sessionId);
  if (!session) {
    throw new Error("unknown session");
  }
  runtime.store.append(sessionId, { type: "user/message", text: trimmed, mentions: [] });
  if (session.title === "새 세션") {
    runtime.store.setTitle(sessionId, titleFromText(trimmed));
  }
  void pump(runtime, sessionId);
}

async function pump(runtime: Runtime, sessionId: SessionId): Promise<void> {
  if (busy.has(sessionId)) {
    return;
  }
  busy.add(sessionId);
  try {
    while (sessionNeedsTurn(runtime.store.events(sessionId))) {
      const config = await loadConfig(runtime.env.home);
      const secrets = await loadSecrets(runtime.env.home);
      await runTurn(sessionId, {
        store: runtime.store,
        llm: runtime.llm,
        apiKey: secrets.xaiApiKey,
        baseURL: config.llm.baseURL,
        model: config.llm.model,
      });
    }
  } finally {
    busy.delete(sessionId);
  }
}
