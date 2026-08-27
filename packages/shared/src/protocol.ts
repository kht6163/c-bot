import type { SessionEvent, SessionKind } from "./events.ts";
import type { BotId, SessionId, ToolCallId } from "./ids.ts";

export const PROTOCOL_VERSION = 0 as const;

export interface SessionSummary {
  id: SessionId;
  title: string;
  kind: SessionKind;
  botId: BotId | null;
  workspace: string | null;
  updatedAt: string;
}

export type ClientFrame =
  | { type: "subscribe"; sessionId: SessionId }
  | { type: "unsubscribe"; sessionId: SessionId }
  | { type: "send"; sessionId: SessionId; text: string }
  | { type: "approve"; sessionId: SessionId; callId: ToolCallId; allow: boolean };

export type ServerFrame =
  | { type: "hello"; version: typeof PROTOCOL_VERSION }
  | { type: "event"; sessionId: SessionId; event: SessionEvent }
  | { type: "error"; message: string; code?: string };

export interface HealthResponse {
  ok: true;
  name: "c-bot";
  version: typeof PROTOCOL_VERSION;
}
