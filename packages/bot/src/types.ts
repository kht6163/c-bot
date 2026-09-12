import type { BotId, BotToolName, SessionId } from "@cbot/shared";

export const BOT_CHAT_TITLE = "Bot Chat";
export const PROTOCOL_HEADING = "## Messaging other agents";
export const MESSAGE_MAX_CHARS = 16_000;
export const LEADER_HANDLE = "leader";
/** Default idle wait when a bot enables idle auto-compact. */
export const DEFAULT_AUTO_COMPACT_IDLE_MS = 60_000;

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
  /** Tools this bot may use besides `message_agent`. null is every tool. */
  tools: BotToolName[] | null;
  soul: string;
  /** Names of the skills under `bots/<id>/skills/`, in prompt order. */
  skills: string[];
  sessionId: SessionId;
  /**
   * When true, idle wall-clock + global `compactAt` can trigger the same
   * session summary as `/compact` for this bot's sessions only. Default off.
   */
  autoCompactIdle: boolean;
  /** Idle milliseconds required before an idle auto-compact may run. */
  autoCompactIdleMs: number;
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
  /** Tools this bot may use besides `message_agent`. null is every tool. */
  tools: BotToolName[] | null;
  sessionId: SessionId;
  autoCompactIdle: boolean;
  autoCompactIdleMs: number;
}
