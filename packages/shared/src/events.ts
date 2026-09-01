import type { BotId, DeliveryId, SessionId, ToolCallId, TurnId } from "./ids.ts";
import type { DeliveryReason } from "./reasons.ts";

/** Bump only when the durable event JSON cannot be read by this code. */
export const SESSION_FORMAT_VERSION = 0 as const;

export type SessionKind = "coding" | "bot-chat";

export type ToolUiKind = "generic" | "diff" | "terminal";

export type IsoTime = string;

export interface EventEnvelope {
  seq: number;
  time: IsoTime;
}

export interface Mention {
  handle: string;
  botId: BotId;
}

export interface AttachedFile {
  path: string;
  content: string;
}

export interface LoggedToolCall {
  id: ToolCallId;
  name: string;
  arguments: string;
  ui: ToolUiKind;
}

export interface TurnStartEvent extends EventEnvelope {
  type: "turn/start";
  turnId: TurnId;
}

export interface TurnEndEvent extends EventEnvelope {
  type: "turn/end";
  turnId: TurnId;
  /** The user stopped this turn; the model never saw the step it was running. */
  aborted?: boolean;
}

export interface UserMessageEvent extends EventEnvelope {
  type: "user/message";
  text: string;
  mentions: readonly Mention[];
  files?: readonly AttachedFile[];
}

export interface AssistantChunkEvent extends EventEnvelope {
  type: "assistant/chunk";
  turnId: TurnId;
  text: string;
}

export interface AssistantMessageEvent extends EventEnvelope {
  type: "assistant/message";
  turnId: TurnId;
  text: string;
  toolCalls: readonly LoggedToolCall[];
}

export interface ToolCallEvent extends EventEnvelope {
  type: "tool/call";
  turnId: TurnId;
  call: LoggedToolCall;
}

export interface ToolResultEvent extends EventEnvelope {
  type: "tool/result";
  turnId: TurnId;
  callId: ToolCallId;
  ok: boolean;
  content: string;
  pendingApproval?: boolean;
}

export interface BotMessageEvent extends EventEnvelope {
  type: "bot/message";
  deliveryId: DeliveryId;
  fromBotId: BotId;
  fromHandle: string;
  fromTitle: string;
  text: string;
  replyToSessionId?: SessionId;
}

export interface AssistantThinkingEvent extends EventEnvelope {
  type: "assistant/thinking";
  turnId: TurnId;
  text: string;
}

export interface BotDeliveryEvent extends EventEnvelope {
  type: "bot/delivery";
  deliveryId: DeliveryId;
  ok: boolean;
  reason?: DeliveryReason;
  target: string;
}

export interface RecalledMemory {
  id: string;
  title: string;
  body: string;
}

export interface MemoryRecallEvent extends EventEnvelope {
  type: "memory/recall";
  botId: BotId;
  query: string;
  items: readonly RecalledMemory[];
}

export interface ContextCompactEvent extends EventEnvelope {
  type: "context/compact";
  /** Model history restarts here: events up to this seq are replaced by `summary`. */
  throughSeq: number;
  summary: string;
  /** Estimated tokens of the span the summary replaced. Display only. */
  tokensBefore: number;
  /** True when the loop compacted on its own instead of the user asking. */
  auto: boolean;
}

export interface ContextClearEvent extends EventEnvelope {
  type: "context/clear";
}

/**
 * What a slash command answered. Written by the server, shown in the log,
 * and never derived into model history: it is UI, not conversation.
 */
export interface SystemNoticeEvent extends EventEnvelope {
  type: "system/notice";
  command: string;
  text: string;
}

export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TaskChangeEvent extends EventEnvelope {
  type: "task/change";
  action: "add" | "update" | "remove";
  taskId: string;
  title: string;
  status: TaskStatus;
  ownerHandle: string;
  requesterHandle: string;
}

export type SessionEvent =
  | TurnStartEvent
  | TurnEndEvent
  | UserMessageEvent
  | AssistantChunkEvent
  | AssistantThinkingEvent
  | AssistantMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | BotMessageEvent
  | BotDeliveryEvent
  | MemoryRecallEvent
  | TaskChangeEvent
  | ContextCompactEvent
  | ContextClearEvent
  | SystemNoticeEvent;
