import {
  ApprovalGate,
  CLIPROXYAPI_ID,
  defaultThinking,
  OpenAiCompatClient,
  SessionStore,
  codingSystemPrompt,
  ensureHome,
  loadConfig,
  loadSecrets,
  providerKey,
  resolveLlmEndpoint,
  saveProviderKey,
  loadMentionedFiles,
  runTurn,
  sessionNeedsTurn,
  sessionsDbPath,
  titleFromText,
  type LlmClient,
  type ToolDefinition,
} from "@cbot/agent";
import {
  ensureLeaderBot,
  listBots,
  loadBot,
  memoryTool,
  messageAgentTool,
  protocolSection,
  recallIntoSession,
  taskTool,
  workspaceForMailbox,
  withProtocol,
} from "@cbot/bot";
import { resolve } from "node:path";
import { atTokens, type SessionId, type ToolCallId } from "@cbot/shared";
import type { ProcessEnv } from "./env.ts";
import { EventHub } from "./hub.ts";

export interface Runtime {
  env: ProcessEnv;
  store: SessionStore;
  hub: EventHub;
  llm: LlmClient;
  approvals: ApprovalGate;
  launchDir: string;
}

const busy = new Set<string>();
const pendingWake = new Set<string>();

async function adoptLegacyApiKey(home: string): Promise<void> {
  const config = await loadConfig(home);
  const secrets = await loadSecrets(home);
  const cliproxy = config.llm.providers.find((item) => item.id === CLIPROXYAPI_ID);
  if (cliproxy && !providerKey(secrets, CLIPROXYAPI_ID)) {
    const leftover = secrets.keys.CUSTOM_API_KEY ?? secrets.keys.XAI_API_KEY;
    if (leftover) {
      await saveProviderKey(home, CLIPROXYAPI_ID, leftover);
    }
  }
  if (config.llm.providers.some((item) => item.id === "custom") && !providerKey(secrets, "custom")) {
    const leftover = secrets.keys.XAI_API_KEY;
    if (leftover) {
      await saveProviderKey(home, "custom", leftover);
    }
  }
}

export async function createRuntime(
  env: ProcessEnv,
  llm?: LlmClient,
  launchDir: string = resolve(process.cwd()),
): Promise<Runtime> {
  await ensureHome(env.home);
  await adoptLegacyApiKey(env.home);
  const store = await SessionStore.open(sessionsDbPath(env.home));
  await ensureLeaderBot(env.home, store);
  const hub = new EventHub();
  store.onAppend((sessionId, event) => {
    hub.emit(sessionId, event);
  });
  return {
    env,
    store,
    hub,
    llm: llm ?? new OpenAiCompatClient(),
    approvals: new ApprovalGate(),
    launchDir: resolve(launchDir),
  };
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
  if (session.kind === "coding" && !session.workspace) {
    throw new Error("workspace required");
  }
  if (session.kind === "bot-chat") {
    throw new Error("direct bot chat is disabled");
  }
  const tokens = atTokens(trimmed);
  const roster = await listBots(runtime.env.home);
  const mentions = tokens.flatMap((token) => {
    const bot = roster.find((item) => item.handle === token);
    return bot ? [{ handle: bot.handle, botId: bot.id }] : [];
  });
  const skip = new Set(mentions.map((item) => item.handle));
  const files =
    session.workspace && session.kind === "coding"
      ? await loadMentionedFiles(session.workspace, tokens, skip)
      : [];
  runtime.store.append(sessionId, {
    type: "user/message",
    text: trimmed,
    mentions,
    ...(files.length > 0 ? { files } : {}),
  });
  if (session.title === "새 세션") {
    runtime.store.setTitle(sessionId, titleFromText(trimmed));
  }
  wakeSession(runtime, sessionId);
}

export function settleApproval(runtime: Runtime, callId: ToolCallId, allow: boolean): boolean {
  return runtime.approvals.settle(callId, allow);
}

export function wakeSession(runtime: Runtime, sessionId: SessionId): void {
  if (busy.has(sessionId)) {
    pendingWake.add(sessionId);
    return;
  }
  void pump(runtime, sessionId);
}

async function pump(runtime: Runtime, sessionId: SessionId): Promise<void> {
  if (busy.has(sessionId)) {
    pendingWake.add(sessionId);
    return;
  }
  busy.add(sessionId);
  try {
    while (runtime.store.get(sessionId) && sessionNeedsTurn(runtime.store.events(sessionId))) {
      const config = await loadConfig(runtime.env.home);
      const secrets = await loadSecrets(runtime.env.home);
      const session = runtime.store.get(sessionId);
      const workspace =
        session?.kind === "bot-chat"
          ? workspaceForMailbox(runtime.store, sessionId)
          : (session?.workspace ?? null);
      let extraTools: ToolDefinition[] = [];
      let systemPrompt: string | undefined;
      let pin: { provider?: string | null; model?: string | null; thinking?: string | null } | undefined;
      const roster = await listBots(runtime.env.home);
      const leader = roster.find((bot) => bot.role === "leader");
      if (session?.kind === "coding" && leader && config.botMode.protocol) {
        const me = await loadBot(runtime.env.home, leader.id);
        if (me) {
          extraTools = [
            messageAgentTool({
              home: runtime.env.home,
              store: runtime.store,
              sessionId,
              sessionKind: session.kind,
              fromBotId: me.id,
              wake: (target) => wakeSession(runtime, target),
            }),
            memoryTool(runtime.env.home, me.id),
            taskTool({
              home: runtime.env.home,
              store: runtime.store,
              sessionId,
              actor: me,
              roster,
            }),
          ];
          const base = [me.soul.trim(), codingSystemPrompt(workspace)]
            .filter((part) => part.length > 0)
            .join("\n\n");
          systemPrompt = withProtocol(base, protocolSection(me, roster, me.soul));
          pin = { provider: me.provider, model: me.model, thinking: me.thinking };
          await recallIntoSession(runtime.env.home, me.id, runtime.store, sessionId);
        }
      } else if (session?.kind === "bot-chat" && session.botId && config.botMode.protocol) {
        const me = await loadBot(runtime.env.home, session.botId);
        if (me) {
          extraTools = [
            messageAgentTool({
              home: runtime.env.home,
              store: runtime.store,
              sessionId,
              sessionKind: session.kind,
              fromBotId: me.id,
              wake: (target) => wakeSession(runtime, target),
            }),
            memoryTool(runtime.env.home, me.id),
            taskTool({
              home: runtime.env.home,
              store: runtime.store,
              sessionId,
              actor: me,
              roster,
            }),
          ];
          const base = [me.soul.trim(), codingSystemPrompt(workspace)]
            .filter((part) => part.length > 0)
            .join("\n\n");
          systemPrompt = withProtocol(base, protocolSection(me, roster, me.soul));
          pin = { provider: me.provider, model: me.model, thinking: me.thinking };
          await recallIntoSession(runtime.env.home, me.id, runtime.store, sessionId);
        }
      }
      const endpoint = resolveLlmEndpoint(config, secrets, pin);
      const active = config.llm.providers.find((item) => item.id === (pin?.provider || config.llm.activeProvider));
      const modelId = endpoint?.model ?? "";
      const levels = active && modelId ? (active.thinking[modelId] ?? []) : [];
      const pinnedEffort = pin?.thinking && levels.includes(pin.thinking) ? pin.thinking : null;
      const globalEffort =
        !pin?.model && config.llm.activeThinking && levels.includes(config.llm.activeThinking)
          ? config.llm.activeThinking
          : null;
      const reasoningEffort = pinnedEffort ?? globalEffort ?? defaultThinking(levels);
      await runTurn(sessionId, {
        store: runtime.store,
        llm: runtime.llm,
        apiKey: endpoint?.apiKey,
        baseURL: endpoint?.baseURL ?? "",
        model: modelId,
        workspace,
        approvalMode: config.approval.mode,
        approvals: runtime.approvals,
        extraTools,
        ...(systemPrompt !== undefined ? { systemPrompt } : {}),
        ...(reasoningEffort && reasoningEffort !== "off" ? { reasoningEffort } : {}),
      });
    }
  } finally {
    busy.delete(sessionId);
    if (pendingWake.delete(sessionId)) {
      wakeSession(runtime, sessionId);
    }
  }
}
