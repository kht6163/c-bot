import {
  ApprovalGate,
  OpenAiCompatClient,
  SessionStore,
  codingSystemPrompt,
  ensureHome,
  loadConfig,
  loadSecrets,
  runTurn,
  sessionNeedsTurn,
  sessionsDbPath,
  titleFromText,
  type LlmClient,
  type ToolDefinition,
} from "@cbot/agent";
import { listBots, loadBot, messageAgentTool, protocolSection, withProtocol } from "@cbot/bot";
import { resolve } from "node:path";
import type { SessionId, ToolCallId } from "@cbot/shared";
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

export async function createRuntime(
  env: ProcessEnv,
  llm?: LlmClient,
  launchDir: string = resolve(process.cwd()),
): Promise<Runtime> {
  await ensureHome(env.home);
  const store = await SessionStore.open(sessionsDbPath(env.home));
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
  runtime.store.append(sessionId, { type: "user/message", text: trimmed, mentions: [] });
  if (session.kind !== "bot-chat" && session.title === "새 세션") {
    runtime.store.setTitle(sessionId, titleFromText(trimmed));
  }
  wakeSession(runtime, sessionId);
}

export function settleApproval(runtime: Runtime, callId: ToolCallId, allow: boolean): boolean {
  return runtime.approvals.settle(callId, allow);
}

export function wakeSession(runtime: Runtime, sessionId: SessionId): void {
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
      const session = runtime.store.get(sessionId);
      let extraTools: ToolDefinition[] = [];
      let systemPrompt: string | undefined;
      let model = config.llm.model;
      if (session?.kind === "bot-chat" && session.botId && config.botMode.protocol) {
        const me = await loadBot(runtime.env.home, session.botId);
        if (me) {
          const roster = await listBots(runtime.env.home);
          extraTools = [
            messageAgentTool({
              home: runtime.env.home,
              store: runtime.store,
              sessionId,
              sessionKind: session.kind,
              fromBotId: me.id,
              wake: (target) => wakeSession(runtime, target),
            }),
          ];
          const base = [me.soul.trim(), codingSystemPrompt(session.workspace)]
            .filter((part) => part.length > 0)
            .join("\n\n");
          systemPrompt = withProtocol(base, protocolSection(me, roster, me.soul));
          if (me.model) {
            model = me.model;
          }
        }
      }
      await runTurn(sessionId, {
        store: runtime.store,
        llm: runtime.llm,
        apiKey: secrets.xaiApiKey,
        baseURL: config.llm.baseURL,
        model,
        workspace: session?.workspace ?? null,
        approvalMode: config.approval.mode,
        approvals: runtime.approvals,
        extraTools,
        ...(systemPrompt !== undefined ? { systemPrompt } : {}),
      });
    }
  } finally {
    busy.delete(sessionId);
  }
}
