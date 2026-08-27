import { assertNever, type SessionEvent } from "@cbot/shared";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: readonly {
    id: string;
    name: string;
    arguments: string;
  }[];
}

/**
 * Projects model history from the session log.
 * Chunks are not model-visible once the matching assistant/message exists;
 * they are never sent to the model.
 */
export function deriveMessages(events: readonly SessionEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const event of events) {
    switch (event.type) {
      case "user/message":
        messages.push({ role: "user", content: event.text });
        break;
      case "bot/message":
        messages.push({ role: "user", content: event.text });
        break;
      case "assistant/message":
        messages.push({
          role: "assistant",
          content: event.text,
          ...(event.toolCalls.length > 0
            ? {
                toolCalls: event.toolCalls.map((call) => ({
                  id: call.id,
                  name: call.name,
                  arguments: call.arguments,
                })),
              }
            : {}),
        });
        break;
      case "tool/result":
        if (event.pendingApproval) {
          break;
        }
        messages.push({
          role: "tool",
          content: event.content,
          toolCallId: event.callId,
        });
        break;
      case "turn/start":
      case "turn/end":
      case "assistant/chunk":
      case "tool/call":
      case "bot/delivery":
        break;
      default:
        assertNever(event);
    }
  }
  return messages;
}
