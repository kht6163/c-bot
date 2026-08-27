import { brand, type Brand } from "./brand.ts";

export type SessionId = Brand<string, "SessionId">;
export type BotId = Brand<string, "BotId">;
export type DeliveryId = Brand<string, "DeliveryId">;
export type TurnId = Brand<string, "TurnId">;
export type ToolCallId = Brand<string, "ToolCallId">;

export function asSessionId(value: string): SessionId {
  return brand<"SessionId">(value);
}

export function asBotId(value: string): BotId {
  return brand<"BotId">(value);
}

export function asDeliveryId(value: string): DeliveryId {
  return brand<"DeliveryId">(value);
}

export function asTurnId(value: string): TurnId {
  return brand<"TurnId">(value);
}

export function asToolCallId(value: string): ToolCallId {
  return brand<"ToolCallId">(value);
}

export function newId<B extends string>(prefix: string): Brand<string, B> {
  return brand<B>(`${prefix}_${crypto.randomUUID()}`);
}

export function newSessionId(): SessionId {
  return newId<"SessionId">("ses");
}

export function newBotId(): BotId {
  return newId<"BotId">("bot");
}

export function newDeliveryId(): DeliveryId {
  return newId<"DeliveryId">("dlv");
}

export function newTurnId(): TurnId {
  return newId<"TurnId">("trn");
}

export function newToolCallId(): ToolCallId {
  return newId<"ToolCallId">("call");
}
