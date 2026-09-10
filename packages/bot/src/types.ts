import type { BotId, SessionId } from "@cbot/shared";

export const BOT_CHAT_TITLE = "Bot Chat";
export const PROTOCOL_HEADING = "## Messaging other agents";
export const MESSAGE_MAX_CHARS = 16_000;
export const LEADER_HANDLE = "leader";
/** One in-place retry for a transient provider failure on a bot-to-bot turn. */
export const DELIVERY_RETRY = { attempts: 1, delayMs: 1500 } as const;

export type BotRole = "leader" | "specialist";

export interface BotProfile {
  id: BotId;
  handle: string;
  title: string;
  description: string;
  role: BotRole;
  provider: string | null;
  model: string | null;
  thinking: string | null;
  hidden: boolean;
  soul: string;
  sessionId: SessionId;
}

export interface BotRecord {
  id: BotId;
  handle: string;
  title: string;
  description: string;
  role: BotRole;
  provider: string | null;
  model: string | null;
  thinking: string | null;
  hidden: boolean;
  sessionId: SessionId;
}
