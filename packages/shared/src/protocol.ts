import type { SessionEvent, SessionKind } from "./events.ts";
import type { BotId, SessionId, ToolCallId } from "./ids.ts";

export const PROTOCOL_VERSION = 0 as const;

export interface ProjectView {
  current: string | null;
  recents: string[];
  name: string | null;
  launchDir: string;
  launchName: string | null;
}

export interface SessionSummary {
  id: SessionId;
  title: string;
  kind: SessionKind;
  botId: BotId | null;
  parentId: SessionId | null;
  workspace: string | null;
  updatedAt: string;
}

export interface SessionTeamMember {
  id: BotId;
  handle: string;
  title: string;
  role: "leader" | "specialist";
  sessionId: SessionId;
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
