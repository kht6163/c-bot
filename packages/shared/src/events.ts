import type { BotId, DeliveryId, ToolCallId, TurnId } from "./ids.ts";
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
}

export interface UserMessageEvent extends EventEnvelope {
  type: "user/message";
  text: string;
  mentions: readonly Mention[];
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
}

export interface BotDeliveryEvent extends EventEnvelope {
  type: "bot/delivery";
  deliveryId: DeliveryId;
  ok: boolean;
  reason?: DeliveryReason;
  target: string;
}

export type SessionEvent =
  | TurnStartEvent
  | TurnEndEvent
  | UserMessageEvent
  | AssistantChunkEvent
  | AssistantMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | BotMessageEvent
  | BotDeliveryEvent;
