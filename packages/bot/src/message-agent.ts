import type { SessionStore, ToolDefinition } from "@cbot/agent";
import type { BotId, SessionId, SessionKind } from "@cbot/shared";
import { deliver } from "./mailbox.ts";
import { listBots } from "./roster.ts";
import { MESSAGE_MAX_CHARS } from "./types.ts";

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
      "Send a message to ANOTHER agent on this install. Fire-and-forget: validates the target, prefixes attribution, delivers into their Bot Chat, and returns immediately. Do not wait for a reply. Compose the message yourself; never paste the user's words verbatim. Max 16000 chars.",
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
      if (deps.sessionKind !== "bot-chat") {
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
      const ack = deliver(deps.store, {
        fromBotId: me.id,
        fromHandle: me.handle,
        fromTitle: me.title,
        toSessionId: target.sessionId,
        text: message,
      });
      deps.wake(target.sessionId);
      return JSON.stringify(ack);
    },
  };
}
