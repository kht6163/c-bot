import type { SessionStore, ToolDefinition } from "@cbot/agent";
import { asSessionId, type BotId, type SessionId, type SessionKind } from "@cbot/shared";
import { deliver } from "./mailbox.ts";
import { listBots } from "./roster.ts";
import { LEADER_HANDLE, MESSAGE_MAX_CHARS } from "./types.ts";

export interface MessageAgentDeps {
  home: string;
  store: SessionStore;
  sessionId: SessionId;
  sessionKind: SessionKind;
  fromBotId: BotId;
  wake: (sessionId: SessionId) => void;
}

export function messageAgentTool(deps: MessageAgentDeps): ToolDefinition {
  return {
    name: "message_agent",
    ui: "generic",
    description:
      "Send a message to ANOTHER agent on this install. Fire-and-forget: validates the target, prefixes attribution, delivers into their mailbox, and returns immediately. Do not wait for a reply. Compose the message yourself; never paste the user's words verbatim. Max 16000 chars.",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Teammate handle from the roster, without @.",
        },
        message: { type: "string" },
      },
      required: ["target", "message"],
    },
    needsApproval: () => false,
    async execute(args) {
      if (deps.sessionKind !== "bot-chat" && deps.sessionKind !== "coding") {
        return JSON.stringify({ ok: false, reason: "not_bot_chat" });
      }
      const targetHandle = String(args.target ?? "").trim().replace(/^@/, "");
      const message = String(args.message ?? "");
      if (message.length > MESSAGE_MAX_CHARS) {
        return JSON.stringify({ ok: false, reason: "message_too_large" });
      }
      if (targetHandle.length === 0 || message.trim().length === 0) {
        return JSON.stringify({ ok: false, reason: "unknown" });
      }
      const roster = await listBots(deps.home);
      const me = roster.find((bot) => bot.id === deps.fromBotId);
      const target = roster.find((bot) => bot.handle === targetHandle || bot.id === targetHandle);
      if (!me) {
        return JSON.stringify({ ok: false, reason: "unknown" });
      }
      if (!target) {
        return JSON.stringify({ ok: false, reason: "target_not_found" });
      }
      if (target.id === me.id) {
        return JSON.stringify({ ok: false, reason: "target_self" });
      }
      const origin = codingOrigin(deps.store, deps.sessionId);
      const toSessionId =
        target.role === "leader"
          ? (origin ?? replySessionOf(deps.store, deps.sessionId) ?? target.sessionId)
          : origin
            ? ensureHopMailbox(deps.store, target, origin).id
            : target.sessionId;
      const ack = deliver(deps.store, {
        fromBotId: me.id,
        fromHandle: me.handle,
        fromTitle: me.title,
        toSessionId,
        text: message,
        ...(deps.sessionKind === "coding" || me.role === "leader"
          ? { replyToSessionId: deps.sessionId }
          : {}),
      });
      deps.wake(toSessionId);
      return JSON.stringify(ack);
    },
  };
}

export function ensureHopMailbox(
  store: SessionStore,
  bot: { id: BotId; handle: string },
  parentId: SessionId,
): { id: SessionId } {
  const existing = store.list({ kind: "bot-chat", botId: bot.id, parentId })[0];
  if (existing) {
    return existing;
  }
  const parent = store.get(parentId);
  return store.create({
    kind: "bot-chat",
    title: `@${bot.handle}`,
    botId: bot.id,
    parentId,
    workspace: parent?.workspace ?? null,
  });
}

function codingOrigin(store: SessionStore, sessionId: SessionId): SessionId | undefined {
  const session = store.get(sessionId);
  if (!session) {
    return undefined;
  }
  if (session.kind === "coding") {
    return session.id;
  }
  return session.parentId ?? undefined;
}

function replySessionOf(store: SessionStore, specialistSession: SessionId): SessionId | undefined {
  const events = store.events(specialistSession);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type === "bot/message" && event.replyToSessionId) {
      return asSessionId(event.replyToSessionId);
    }
    if (event?.type === "bot/message" && event.fromHandle === LEADER_HANDLE) {
      return undefined;
    }
  }
  return undefined;
}

/** Workspace the mailbox should use for this turn: the summoning coding session, else its own. */
export function workspaceForMailbox(store: SessionStore, sessionId: SessionId): string | null {
  const own = store.get(sessionId);
  if (own?.workspace) {
    return own.workspace;
  }
  if (own?.parentId) {
    return store.get(own.parentId)?.workspace ?? null;
  }
  const reply = replySessionOf(store, sessionId);
  if (!reply) {
    return own?.workspace ?? null;
  }
  return store.get(reply)?.workspace ?? own?.workspace ?? null;
}
