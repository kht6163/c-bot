import type { DeliveryReason } from "@cbot/shared";
import type { ChatMessage } from "../session/derive.ts";

export class LlmError extends Error {
  readonly reason: DeliveryReason;

  constructor(message: string, reason: DeliveryReason) {
    super(message);
    this.name = "LlmError";
    this.reason = reason;
  }
}

export type LlmStreamEvent =
  | { type: "text"; text: string }
  | { type: "done"; finishReason: string };

export interface LlmRequest {
  baseURL: string;
  apiKey: string;
  model: string;
  system: string;
  messages: readonly ChatMessage[];
}

export interface LlmClient {
  stream(request: LlmRequest): AsyncIterable<LlmStreamEvent>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class OpenAiCompatClient implements LlmClient {
  constructor(private readonly fetchFn: FetchLike = fetch) {}

  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const url = `${trimSlash(request.baseURL)}/chat/completions`;
    const messages = [
      { role: "system", content: request.system },
      ...request.messages.map(toWireMessage),
    ];
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${request.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          stream: true,
          messages,
        }),
      });
    } catch (err) {
      throw new LlmError(String(err), "runtime_offline");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LlmError(body || res.statusText, statusReason(res.status));
    }
    if (!res.body) {
      throw new LlmError("empty LLM body", "unknown");
    }
    for await (const data of readSse(res.body)) {
      if (data === "[DONE]") {
        yield { type: "done", finishReason: "stop" };
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      const text = deltaText(parsed);
      if (text) {
        yield { type: "text", text };
      }
      const finish = finishReason(parsed);
      if (finish) {
        yield { type: "done", finishReason: finish };
        return;
      }
    }
    yield { type: "done", finishReason: "stop" };
  }
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId,
    };
  }
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function statusReason(status: number): DeliveryReason {
  if (status === 401 || status === 403) {
    return "provider_auth_or_access";
  }
  if (status === 402) {
    return "provider_quota_limit";
  }
  if (status === 429) {
    return "provider_rate_limit";
  }
  if (status === 404) {
    return "model_unavailable";
  }
  if (status >= 500) {
    return "provider_server_error";
  }
  return "unknown";
}

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function deltaText(parsed: unknown): string {
  if (!isRecord(parsed) || !Array.isArray(parsed.choices)) {
    return "";
  }
  const choice = parsed.choices[0];
  if (!isRecord(choice) || !isRecord(choice.delta)) {
    return "";
  }
  return typeof choice.delta.content === "string" ? choice.delta.content : "";
}

function finishReason(parsed: unknown): string | undefined {
  if (!isRecord(parsed) || !Array.isArray(parsed.choices)) {
    return undefined;
  }
  const choice = parsed.choices[0];
  if (!isRecord(choice) || typeof choice.finish_reason !== "string") {
    return undefined;
  }
  return choice.finish_reason;
}

async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    while (true) {
      const idx = buffer.indexOf("\n\n");
      if (idx === -1) {
        break;
      }
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of block.split("\n")) {
        if (line.startsWith("data:")) {
          yield line.slice(5).trimStart();
        }
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
