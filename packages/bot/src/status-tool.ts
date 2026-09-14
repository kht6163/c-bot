import type { SessionStore, ToolDefinition } from "@cbot/agent";
import { AGENT_STATUS_MAX, normalizeAgentStatus, type SessionId } from "@cbot/shared";
import type { BotRecord } from "./types.ts";

/**
 * The bot's own line about the moment. It writes to the session log and nowhere
 * else: not the session title, which names the session, and not the task board,
 * which keeps a record. This one is overwritten every time.
 */
export function statusTool(opts: {
  store: SessionStore;
  sessionId: SessionId;
  actor: BotRecord;
}): ToolDefinition {
  return {
    name: "set_status",
    ui: "generic",
    description:
      "Say in one short line what you are working on right now. Your node in the team graph shows this line, so the user can see who is holding what without opening a log. Set it when you start something that takes more than a moment, replace it when you move on, and pass an empty string once you are idle. Write it in the present tense in the language the user writes in. This is neither the session title nor a task board row: the newest line replaces the last one and no history is kept.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: `What you are doing now, at most ${AGENT_STATUS_MAX} characters — longer lines are clipped. An empty string clears the line.`,
        },
      },
      required: ["text"],
    },
    needsApproval: () => false,
    async execute(args) {
      const text = normalizeAgentStatus(typeof args.text === "string" ? args.text : "");
      opts.store.append(opts.sessionId, {
        type: "agent/status",
        botId: opts.actor.id,
        handle: opts.actor.handle,
        text,
      });
      return JSON.stringify({ ok: true, status: text });
    },
  };
}
