import { assertNever, type AttachedFile, type SessionEvent } from "@cbot/shared";

const ABORTED_TURN = "[사용자가 위 턴을 중단했습니다.]";

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
        messages.push({ role: "user", content: userContent(event.text, event.files) });
        break;
      case "bot/message":
        messages.push({ role: "user", content: event.text });
        break;
      case "memory/recall":
        if (event.items.length > 0) {
          messages.push({ role: "user", content: formatRecalledMemory(event.items) });
        }
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
      case "turn/end":
        // The model must know its own answer was cut short, not merely short.
        if (event.aborted) {
          messages.push({ role: "user", content: ABORTED_TURN });
        }
        break;
      case "turn/start":
      case "assistant/chunk":
      case "assistant/thinking":
      case "tool/call":
      case "bot/delivery":
      case "task/change":
        break;
      default:
        assertNever(event);
    }
  }
  return messages;
}

function formatRecalledMemory(items: readonly { title: string; body: string }[]): string {
  const lines = items.map((item) => `- ${item.title}: ${item.body}`);
  return `Recalled memory:\n${lines.join("\n")}`;
}

function userContent(text: string, files: readonly AttachedFile[] | undefined): string {
  if (!files || files.length === 0) {
    return text;
  }
  const attached = files
    .map((file) => `Referenced file \`${file.path}\`:\n\`\`\`\n${file.content}\n\`\`\``)
    .join("\n\n");
  return `${text}\n\n${attached}`;
}
