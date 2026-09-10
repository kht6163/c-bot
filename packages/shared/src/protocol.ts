import type { ApprovalRemember } from "./approval.ts";
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
  | {
      type: "approve";
      sessionId: SessionId;
      callId: ToolCallId;
      allow: boolean;
      /** With allow, also skip the card for this command prefix from now on. */
      remember?: ApprovalRemember;
    };

export type ServerFrame =
  | { type: "hello"; version: typeof PROTOCOL_VERSION }
  | { type: "event"; sessionId: SessionId; event: SessionEvent }
  /**
   * A coding session started or finished working. Sent to every socket, not
   * only subscribers, so the sidebar can mark sessions the user is not watching.
   * `running` covers the session's own turn and the specialist hops it summoned.
   */
  | { type: "session/activity"; sessionId: SessionId; running: boolean }
  | { type: "error"; message: string; code?: string };

export interface SessionListResponse {
  sessions: SessionSummary[];
  /** Coding sessions with an open turn at the time of the request. */
  running: SessionId[];
}

export interface HealthResponse {
  ok: true;
  name: "c-bot";
  version: typeof PROTOCOL_VERSION;
}
