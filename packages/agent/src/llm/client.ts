import type { DeliveryReason } from "@cbot/shared";
import { defaultThinking, modelsQueryFor, sanitizeThinking } from "../catalog.ts";
import type { AppConfig, LlmProvider } from "../config.ts";
import { providerKey, type Secrets } from "../secrets.ts";
import type { ChatMessage } from "../session/derive.ts";
import type { ToolSchema } from "../tools/types.ts";

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
  | { type: "thinking"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: string }
  | { type: "done"; finishReason: string };

export interface LlmRequest {
  baseURL: string;
  apiKey: string;
  model: string;
  system: string;
  messages: readonly ChatMessage[];
  tools?: readonly ToolSchema[];
  reasoningEffort?: string;
  signal?: AbortSignal;
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
        ...(request.signal ? { signal: request.signal } : {}),
        headers: {
          authorization: `Bearer ${request.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          stream: true,
          messages,
          ...(request.reasoningEffort && request.reasoningEffort !== "off"
            ? { reasoning_effort: request.reasoningEffort }
            : {}),
          ...(request.tools && request.tools.length > 0
            ? {
                tools: request.tools.map((tool) => ({
                  type: "function",
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  },
                })),
              }
            : {}),
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
    const acc = new Map<number, { id: string; name: string; arguments: string }>();
    let finish = "stop";
    for await (const data of readSse(res.body)) {
      if (data === "[DONE]") {
        break;
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
      const thinking = deltaThinking(parsed);
      if (thinking) {
        yield { type: "thinking", text: thinking };
      }
      mergeToolDelta(acc, parsed);
      const nextFinish = finishReason(parsed);
      if (nextFinish) {
        finish = nextFinish;
      }
    }
    for (const call of [...acc.values()]) {
      if (call.name.length > 0) {
        yield { type: "tool_call", id: call.id, name: call.name, arguments: call.arguments };
      }
    }
    yield { type: "done", finishReason: finish };
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

function mergeToolDelta(
  acc: Map<number, { id: string; name: string; arguments: string }>,
  parsed: unknown,
): void {
  if (!isRecord(parsed) || !Array.isArray(parsed.choices)) {
    return;
  }
  const choice = parsed.choices[0];
  if (!isRecord(choice) || !isRecord(choice.delta) || !Array.isArray(choice.delta.tool_calls)) {
    return;
  }
  for (const raw of choice.delta.tool_calls) {
    if (!isRecord(raw) || typeof raw.index !== "number") {
      continue;
    }
    const current = acc.get(raw.index) ?? { id: "", name: "", arguments: "" };
    if (typeof raw.id === "string") {
      current.id = raw.id;
    }
    if (isRecord(raw.function)) {
      if (typeof raw.function.name === "string") {
        current.name += raw.function.name;
      }
      if (typeof raw.function.arguments === "string") {
        current.arguments += raw.function.arguments;
      }
    }
    acc.set(raw.index, current);
  }
}

function deltaThinking(parsed: unknown): string {
  if (!isRecord(parsed) || !Array.isArray(parsed.choices)) {
    return "";
  }
  const choice = parsed.choices[0];
  if (!isRecord(choice) || !isRecord(choice.delta)) {
    return "";
  }
  const delta = choice.delta;
  if (typeof delta.reasoning_content === "string") {
    return delta.reasoning_content;
  }
  if (typeof delta.reasoning === "string") {
    return delta.reasoning;
  }
  if (typeof delta.thinking === "string") {
    return delta.thinking;
  }
  if (isRecord(delta.thinking) && typeof delta.thinking.text === "string") {
    return delta.thinking.text;
  }
  return "";
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

function catalogRows(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }
  if (!isRecord(body)) {
    return [];
  }
  if (Array.isArray(body.models)) {
    return body.models;
  }
  if (Array.isArray(body.data)) {
    return body.data;
  }
  return [];
}

function parseRemoteModel(raw: unknown): RemoteModel | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  if (raw.visibility === "hide") {
    return undefined;
  }
  const id =
    typeof raw.slug === "string" && raw.slug.trim()
      ? raw.slug.trim()
      : typeof raw.id === "string"
        ? raw.id.trim()
        : "";
  if (id.length === 0) {
    return undefined;
  }
  const thinking = sanitizeThinking(
    raw.supported_reasoning_levels ??
      (isRecord(raw.thinking) ? raw.thinking.levels : undefined) ??
      raw.thinking_levels,
  );
  return { id, thinking };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export interface LlmProbeInput {
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface LlmProbeResult {
  ok: boolean;
  message: string;
  model: string;
  reason?: DeliveryReason;
}

/**
 * Checks that the OpenAI-compatible endpoint accepts this key.
 * Prefers GET /models; falls back to a tiny chat completion.
 */
export interface RemoteModel {
  id: string;
  thinking: string[];
}

export async function listRemoteModels(
  input: { baseURL: string; apiKey: string; modelsQuery?: string },
  fetchFn: FetchLike = fetch,
): Promise<string[]> {
  return (await listRemoteModelCatalog(input, fetchFn)).map((item) => item.id);
}

export async function listRemoteModelCatalog(
  input: { baseURL: string; apiKey: string; modelsQuery?: string },
  fetchFn: FetchLike = fetch,
): Promise<RemoteModel[]> {
  const key = input.apiKey.trim();
  const baseURL = trimSlash(input.baseURL.trim());
  if (key.length === 0 || baseURL.length === 0) {
    return [];
  }
  const headers = { authorization: `Bearer ${key}` };
  const primary = input.modelsQuery ? `${baseURL}/models?${input.modelsQuery}` : `${baseURL}/models`;
  let res = await fetchFn(primary, { headers });
  if (!res.ok && input.modelsQuery) {
    res = await fetchFn(`${baseURL}/models`, { headers });
  }
  if (!res.ok) {
    throw new LlmError(res.statusText, statusReason(res.status));
  }
  const body: unknown = await res.json().catch(() => null);
  const rows = catalogRows(body);
  const out: RemoteModel[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const parsed = parseRemoteModel(row);
    if (!parsed || seen.has(parsed.id)) {
      continue;
    }
    seen.add(parsed.id);
    out.push(parsed);
  }
  return out;
}

export function needsThinkingRefresh(provider: LlmProvider): boolean {
  if (!modelsQueryFor(provider.id, provider.baseURL) || provider.models.length === 0) {
    return false;
  }
  return provider.models.some((model) => (provider.thinking[model] ?? []).length === 0);
}

export async function refreshProviderThinking(
  config: AppConfig,
  secrets: Secrets,
  fetchFn: FetchLike = fetch,
): Promise<AppConfig> {
  let next = config;
  for (const provider of config.llm.providers) {
    const query = modelsQueryFor(provider.id, provider.baseURL);
    const apiKey = providerKey(secrets, provider.id);
    if (!query || !apiKey || !needsThinkingRefresh(provider)) {
      continue;
    }
    try {
      const catalog = await listRemoteModelCatalog(
        { baseURL: provider.baseURL, apiKey, modelsQuery: query },
        fetchFn,
      );
      const thinking = { ...provider.thinking };
      let changed = false;
      for (const item of catalog) {
        if (item.thinking.length === 0) {
          continue;
        }
        const prev = thinking[item.id] ?? [];
        if (prev.length === item.thinking.length && prev.every((level, i) => level === item.thinking[i])) {
          continue;
        }
        thinking[item.id] = item.thinking;
        changed = true;
      }
      if (!changed) {
        continue;
      }
      const providers = next.llm.providers.map((item) =>
        item.id === provider.id ? { ...item, thinking } : item,
      );
      const active = providers.find((item) => item.id === next.llm.activeProvider);
      const levels = active && next.llm.activeModel ? (active.thinking[next.llm.activeModel] ?? []) : [];
      const activeThinking =
        next.llm.activeThinking && levels.includes(next.llm.activeThinking)
          ? next.llm.activeThinking
          : defaultThinking(levels);
      next = { ...next, llm: { ...next.llm, providers, activeThinking } };
    } catch {
      /* keep stored thinking */
    }
  }
  return next;
}

export async function probeLlm(
  input: LlmProbeInput,
  fetchFn: FetchLike = fetch,
): Promise<LlmProbeResult> {
  const key = input.apiKey.trim();
  const model = input.model.trim();
  const baseURL = trimSlash(input.baseURL.trim());
  if (key.length === 0) {
    return { ok: false, message: "API 키가 없습니다.", model, reason: "missing_config" };
  }
  if (baseURL.length === 0 || model.length === 0) {
    return { ok: false, message: "모델과 Base URL이 필요합니다.", model, reason: "missing_config" };
  }
  try {
    const modelsRes = await fetchFn(`${baseURL}/models`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (modelsRes.ok) {
      return { ok: true, message: "엔드포인트가 API 키를 수락했습니다.", model };
    }
    if (modelsRes.status === 401 || modelsRes.status === 403) {
      return {
        ok: false,
        message: "API 키가 거부되었습니다.",
        model,
        reason: "provider_auth_or_access",
      };
    }
    const chatRes = await fetchFn(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: false,
        max_tokens: 8,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    if (chatRes.ok) {
      return { ok: true, message: "채팅 엔드포인트가 응답했습니다.", model };
    }
    const body = await chatRes.text().catch(() => chatRes.statusText);
    return {
      ok: false,
      message: body || chatRes.statusText,
      model,
      reason: statusReason(chatRes.status),
    };
  } catch (err) {
    return { ok: false, message: String(err), model, reason: "runtime_offline" };
  }
}
