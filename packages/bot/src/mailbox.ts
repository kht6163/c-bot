import { newDeliveryId, type BotId, type DeliveryId, type SessionId } from "@cbot/shared";
import type { SessionStore } from "@cbot/agent";
import type { DeliveryReason } from "@cbot/shared";

export interface MailboxSend {
  fromBotId: BotId;
  fromHandle: string;
  fromTitle: string;
  toSessionId: SessionId;
  text: string;
}

export interface MailboxAck {
  ok: boolean;
  deliveryId: DeliveryId;
  reason?: DeliveryReason;
}

export function attributedText(fromTitle: string, fromHandle: string, message: string): string {
  return `Message from 🤖 ${fromTitle} (@${fromHandle}):\n\n${message}`;
}

export function deliver(store: SessionStore, send: MailboxSend): MailboxAck {
  const deliveryId = newDeliveryId();
  store.append(send.toSessionId, {
    type: "bot/message",
    deliveryId,
    fromBotId: send.fromBotId,
    fromHandle: send.fromHandle,
    fromTitle: send.fromTitle,
    text: attributedText(send.fromTitle, send.fromHandle, send.text),
  });
  return { ok: true, deliveryId };
}
