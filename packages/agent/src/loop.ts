import {
  asToolCallId,
  newToolCallId,
  newTurnId,
  type LoggedToolCall,
  type SessionEvent,
  type SessionId,
} from "@cbot/shared";
import type { ApprovalGate } from "./approval.ts";
import type { LlmClient } from "./llm/client.ts";
import { LlmError } from "./llm/client.ts";
import { codingSystemPrompt } from "./prompt.ts";
import { deriveMessages } from "./session/derive.ts";
import type { SessionStore } from "./session/store.ts";
import { findTool, codingToolSchemas } from "./tools/registry.ts";
import type { ToolContext, ToolSchema } from "./tools/types.ts";

const CHUNK_FLUSH_MS = 40;
const MAX_STEPS = 40;

export interface TurnContext {
  store: SessionStore;
  llm: LlmClient;
  apiKey: string | undefined;
  baseURL: string;
  model: string;
  workspace: string | null;
  approvalMode: "prompt" | "allow";
  approvals: ApprovalGate;
  systemPrompt?: string;
}

export async function runTurn(sessionId: SessionId, ctx: TurnContext): Promise<void> {
  const turnId = newTurnId();
  ctx.store.append(sessionId, { type: "turn/start", turnId });
  if (!ctx.apiKey) {
    ctx.store.append(sessionId, {
      type: "assistant/message",
      turnId,
      text: "[reason: missing_config] XAI_API_KEY가 없습니다. 설정에서 키를 넣으세요.",
      toolCalls: [],
    });
    ctx.store.append(sessionId, { type: "turn/end", turnId });
    return;
  }
  const tools = ctx.workspace ? codingToolSchemas() : [];
  const system = ctx.systemPrompt ?? codingSystemPrompt(ctx.workspace);
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const outcome = await runStep(sessionId, turnId, ctx, system, tools);
      if (outcome === "stop") {
        ctx.store.append(sessionId, { type: "turn/end", turnId });
        return;
      }
    }
    ctx.store.append(sessionId, {
      type: "assistant/message",
      turnId,
      text: "도구 호출 한도에 도달했습니다.",
      toolCalls: [],
    });
  } catch (err) {
    const reason = err instanceof LlmError ? err.reason : "unknown";
    const detail = err instanceof Error ? err.message : String(err);
    ctx.store.append(sessionId, {
      type: "assistant/message",
      turnId,
      text: `[reason: ${reason}] ${detail}`,
      toolCalls: [],
    });
  }
  ctx.store.append(sessionId, { type: "turn/end", turnId });
}

async function runStep(
  sessionId: SessionId,
  turnId: ReturnType<typeof newTurnId>,
  ctx: TurnContext,
  system: string,
  tools: ToolSchema[],
): Promise<"stop" | "continue"> {
  const history = deriveMessages(ctx.store.events(sessionId));
  let full = "";
  let pending = "";
  let lastFlush = Date.now();
  const toolCalls: LoggedToolCall[] = [];
  const flush = (force: boolean) => {
    if (pending.length === 0) {
      return;
    }
    const now = Date.now();
    if (!force && now - lastFlush < CHUNK_FLUSH_MS) {
      return;
    }
    ctx.store.append(sessionId, { type: "assistant/chunk", turnId, text: pending });
    pending = "";
    lastFlush = now;
  };
  for await (const event of ctx.llm.stream({
    baseURL: ctx.baseURL,
    apiKey: ctx.apiKey ?? "",
    model: ctx.model,
    system,
    messages: history,
    ...(tools.length > 0 ? { tools } : {}),
  })) {
    if (event.type === "text") {
      full += event.text;
      pending += event.text;
      flush(false);
    } else if (event.type === "tool_call") {
      const tool = findTool(event.name);
      toolCalls.push({
        id: event.id ? asToolCallId(event.id) : newToolCallId(),
        name: event.name,
        arguments: event.arguments,
        ui: tool?.ui ?? "generic",
      });
    }
  }
  flush(true);
  ctx.store.append(sessionId, {
    type: "assistant/message",
    turnId,
    text: full,
    toolCalls,
  });
  if (toolCalls.length === 0) {
    return "stop";
  }
  const toolCtx: ToolContext | undefined = ctx.workspace
    ? { workspace: ctx.workspace, approvalMode: ctx.approvalMode }
    : undefined;
  for (const call of toolCalls) {
    ctx.store.append(sessionId, { type: "tool/call", turnId, call });
    const tool = findTool(call.name);
    if (!tool || !toolCtx) {
      ctx.store.append(sessionId, {
        type: "tool/result",
        turnId,
        callId: call.id,
        ok: false,
        content: tool ? "workspace is required" : `unknown tool ${call.name}`,
      });
      continue;
    }
    let args: Record<string, unknown> = {};
    try {
      args = parseArgs(call.arguments);
    } catch (err) {
      ctx.store.append(sessionId, {
        type: "tool/result",
        turnId,
        callId: call.id,
        ok: false,
        content: err instanceof Error ? err.message : "invalid arguments",
      });
      continue;
    }
    if (tool.needsApproval(args, toolCtx)) {
      ctx.store.append(sessionId, {
        type: "tool/result",
        turnId,
        callId: call.id,
        ok: true,
        content: "승인 대기 중",
        pendingApproval: true,
      });
      const allowed = await ctx.approvals.wait(call.id);
      if (!allowed) {
        ctx.store.append(sessionId, {
          type: "tool/result",
          turnId,
          callId: call.id,
          ok: false,
          content: "사용자가 도구 실행을 거절했습니다.",
        });
        continue;
      }
    }
    try {
      const content = await tool.execute(args, toolCtx);
      ctx.store.append(sessionId, {
        type: "tool/result",
        turnId,
        callId: call.id,
        ok: true,
        content,
      });
    } catch (err) {
      ctx.store.append(sessionId, {
        type: "tool/result",
        turnId,
        callId: call.id,
        ok: false,
        content: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return "continue";
}

function parseArgs(raw: string): Record<string, unknown> {
  if (raw.trim().length === 0) {
    return {};
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("tool arguments must be an object");
  }
  return parsed as Record<string, unknown>;
}

/** True when a user or bot message sits after the last finished turn. */
export function sessionNeedsTurn(events: readonly SessionEvent[]): boolean {
  let lastTurnEnd = 0;
  let lastInput = 0;
  for (const event of events) {
    if (event.type === "turn/end") {
      lastTurnEnd = event.seq;
    }
    if (event.type === "user/message" || event.type === "bot/message") {
      lastInput = event.seq;
    }
  }
  return lastInput > lastTurnEnd;
}

export function titleFromText(text: string): string {
  const oneLine = text.trim().split(/\r?\n/, 1)[0] ?? "";
  if (oneLine.length <= 40) {
    return oneLine || "새 세션";
  }
  return `${oneLine.slice(0, 40)}…`;
}
