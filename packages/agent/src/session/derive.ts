import { assertNever, type AttachedFile, type AttachedImage, type SessionEvent } from "@cbot/shared";

const ABORTED_TURN = "[사용자가 위 턴을 중단했습니다.]";
const SUMMARY_HEAD = "이전 대화 요약 (원문은 세션 로그에 남아 있다):";

/** One piece of a multimodal user message, in Chat Completions wire shape. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** Parts only when a user message carries pictures; text otherwise. */
  content: string | readonly ContentPart[];
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
  const window = contextWindow(events);
  if (window.summary) {
    messages.push({ role: "user", content: `${SUMMARY_HEAD}\n${window.summary}` });
  }
  for (const event of events) {
    if (event.seq <= window.fromSeq) {
      continue;
    }
    switch (event.type) {
      case "user/message":
        messages.push({ role: "user", content: userContent(event.text, event.files, event.images) });
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
      case "context/compact":
      case "context/clear":
      case "system/notice":
        break;
      default:
        assertNever(event);
    }
  }
  return messages;
}

/**
 * The span of log the model still sees. `/compact` replaces everything up to
 * `fromSeq` with one summary; `/clear` drops it with no summary at all.
 */
function contextWindow(events: readonly SessionEvent[]): { fromSeq: number; summary: string | null } {
  let fromSeq = 0;
  let summary: string | null = null;
  for (const event of events) {
    if (event.type === "context/clear") {
      fromSeq = event.seq;
      summary = null;
    } else if (event.type === "context/compact") {
      fromSeq = event.throughSeq;
      summary = event.summary;
    }
  }
  return { fromSeq, summary };
}

function formatRecalledMemory(items: readonly { title: string; body: string }[]): string {
  const lines = items.map((item) => `- ${item.title}: ${item.body}`);
  return `Recalled memory:\n${lines.join("\n")}`;
}

function userContent(
  text: string,
  files: readonly AttachedFile[] | undefined,
  images: readonly AttachedImage[] | undefined,
): string | ContentPart[] {
  let body = text;
  if (files && files.length > 0) {
    const attached = files
      .map((file) => `Referenced file \`${file.path}\`:\n\`\`\`\n${file.content}\n\`\`\``)
      .join("\n\n");
    body = `${body}\n\n${attached}`;
  }
  if (!images || images.length === 0) {
    return body;
  }
  const names = images.map((image) => `\`${image.path}\``).join(", ");
  return [
    { type: "text", text: `${body}\n\nAttached image${images.length > 1 ? "s" : ""}: ${names}` },
    ...images.map(
      (image): ContentPart => ({
        type: "image_url",
        image_url: { url: `data:${image.mime};base64,${image.data}` },
      }),
    ),
  ];
}

/** The text of a message as a tokenizer would see it; image parts count as nothing here. */
export function contentText(content: ChatMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  return content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

export function imagePartCount(content: ChatMessage["content"]): number {
  return typeof content === "string" ? 0 : content.filter((part) => part.type === "image_url").length;
}
