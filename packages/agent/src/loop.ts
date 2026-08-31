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
import { schemaOf, type ToolContext, type ToolDefinition, type ToolSchema } from "./tools/types.ts";

const CHUNK_FLUSH_MS = 40;
const MAX_STEPS = 40;
const ABORTED_TOOL = "사용자가 턴을 중단해 실행하지 않았습니다.";

export interface TurnContext {
  store: SessionStore;
  llm: LlmClient;
  apiKey: string | undefined;
  baseURL: string;
  model: string;
  workspace: string | null;
  approvalMode: "prompt" | "allow";
  approvals: ApprovalGate;
  extraTools?: ToolDefinition[];
  systemPrompt?: string;
  reasoningEffort?: string;
  /** Aborting ends the turn at the next step boundary; a tool already running still finishes. */
  signal?: AbortSignal;
}

export async function runTurn(sessionId: SessionId, ctx: TurnContext): Promise<void> {
  const turnId = newTurnId();
  ctx.store.append(sessionId, { type: "turn/start", turnId });
  if (!ctx.apiKey) {
    ctx.store.append(sessionId, {
      type: "assistant/message",
      turnId,
      text: "[reason: missing_config] LLM 프로바이더가 없습니다. 설정에서 프로바이더와 키를 넣으세요.",
      toolCalls: [],
    });
    ctx.store.append(sessionId, { type: "turn/end", turnId });
    return;
  }
  const extraTools = ctx.extraTools ?? [];
  const tools = [
    ...(ctx.workspace ? codingToolSchemas() : []),
    ...extraTools.map(schemaOf),
  ];
  const system = ctx.systemPrompt ?? codingSystemPrompt(ctx.workspace);
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (ctx.signal?.aborted) {
        endTurn(ctx, sessionId, turnId, true);
        return;
      }
      const outcome = await runStep(sessionId, turnId, ctx, system, tools, extraTools);
      if (outcome === "aborted") {
        endTurn(ctx, sessionId, turnId, true);
        return;
      }
      if (outcome === "stop") {
        endTurn(ctx, sessionId, turnId, false);
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
    if (!ctx.store.get(sessionId)) {
      return;
    }
    if (ctx.signal?.aborted) {
      endTurn(ctx, sessionId, turnId, true);
      return;
    }
    const reason = err instanceof LlmError ? err.reason : "unknown";
    const detail = err instanceof Error ? err.message : String(err);
    ctx.store.append(sessionId, {
      type: "assistant/message",
      turnId,
      text: `[reason: ${reason}] ${detail}`,
      toolCalls: [],
    });
  }
  if (!ctx.store.get(sessionId)) {
    return;
  }
  endTurn(ctx, sessionId, turnId, ctx.signal?.aborted === true);
}

function endTurn(
  ctx: TurnContext,
  sessionId: SessionId,
  turnId: ReturnType<typeof newTurnId>,
  aborted: boolean,
): void {
  ctx.store.append(sessionId, {
    type: "turn/end",
    turnId,
    ...(aborted ? { aborted: true } : {}),
  });
}

async function runStep(
  sessionId: SessionId,
  turnId: ReturnType<typeof newTurnId>,
  ctx: TurnContext,
  system: string,
  tools: ToolSchema[],
  extraTools: readonly ToolDefinition[],
): Promise<"stop" | "continue" | "aborted"> {
  const history = deriveMessages(ctx.store.events(sessionId));
  let full = "";
  let pending = "";
  let thinkingPending = "";
  let lastFlush = Date.now();
  const toolCalls: LoggedToolCall[] = [];
  const flush = (force: boolean) => {
    const now = Date.now();
    if (!force && now - lastFlush < CHUNK_FLUSH_MS) {
      return;
    }
    if (thinkingPending.length > 0) {
      ctx.store.append(sessionId, { type: "assistant/thinking", turnId, text: thinkingPending });
      thinkingPending = "";
    }
    if (pending.length > 0) {
      ctx.store.append(sessionId, { type: "assistant/chunk", turnId, text: pending });
      pending = "";
    }
    lastFlush = now;
  };
  const sealAborted = () => {
    flush(true);
    // Tool calls the model had started are dropped: an aborted turn runs none of them.
    if (full.length > 0) {
      ctx.store.append(sessionId, { type: "assistant/message", turnId, text: full, toolCalls: [] });
    }
  };
  try {
    for await (const event of ctx.llm.stream({
      baseURL: ctx.baseURL,
      apiKey: ctx.apiKey ?? "",
      model: ctx.model,
      system,
      messages: history,
      ...(tools.length > 0 ? { tools } : {}),
      ...(ctx.reasoningEffort ? { reasoningEffort: ctx.reasoningEffort } : {}),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    })) {
      if (event.type === "thinking") {
        thinkingPending += event.text;
        flush(false);
      } else if (event.type === "text") {
        full += event.text;
        pending += event.text;
        flush(false);
      } else if (event.type === "tool_call") {
        const tool = extraTools.find((item) => item.name === event.name) ?? findTool(event.name);
        toolCalls.push({
          id: event.id ? asToolCallId(event.id) : newToolCallId(),
          name: event.name,
          arguments: event.arguments,
          ui: tool?.ui ?? "generic",
        });
      }
    }
  } catch (err) {
    if (!ctx.signal?.aborted) {
      throw err;
    }
    sealAborted();
    return "aborted";
  }
  if (ctx.signal?.aborted) {
    sealAborted();
    return "aborted";
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
    // Every logged call needs a result, or the derived history loses its tool pairing.
    if (ctx.signal?.aborted) {
      ctx.store.append(sessionId, {
        type: "tool/result",
        turnId,
        callId: call.id,
        ok: false,
        content: ABORTED_TOOL,
      });
      continue;
    }
    const tool = extraTools.find((item) => item.name === call.name) ?? findTool(call.name);
    const extra = extraTools.some((item) => item.name === call.name);
    if (!tool) {
      ctx.store.append(sessionId, {
        type: "tool/result",
        turnId,
        callId: call.id,
        ok: false,
        content: `unknown tool ${call.name}`,
      });
      continue;
    }
    if (!extra && !toolCtx) {
      ctx.store.append(sessionId, {
        type: "tool/result",
        turnId,
        callId: call.id,
        ok: false,
        content: "workspace is required",
      });
      continue;
    }
    const execCtx: ToolContext = toolCtx ?? { workspace: "", approvalMode: ctx.approvalMode };
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
    if (tool.needsApproval(args, execCtx)) {
      ctx.store.append(sessionId, {
        type: "tool/result",
        turnId,
        callId: call.id,
        ok: true,
        content: "승인 대기 중",
        pendingApproval: true,
      });
      const allowed = await ctx.approvals.wait(call.id, ctx.signal);
      if (ctx.signal?.aborted) {
        ctx.store.append(sessionId, {
          type: "tool/result",
          turnId,
          callId: call.id,
          ok: false,
          content: ABORTED_TOOL,
        });
        continue;
      }
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
      const content = await tool.execute(args, execCtx);
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
  return ctx.signal?.aborted ? "aborted" : "continue";
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

/**
 * True when a user or bot message arrived after the last completed turn
 * began. A mailbox delivery that lands during an open turn therefore still
 * owes a follow-up turn once that turn ends.
 */
export function sessionNeedsTurn(events: readonly SessionEvent[]): boolean {
  let lastTurnStart = 0;
  let lastTurnEnd = 0;
  let lastInput = 0;
  for (const event of events) {
    if (event.type === "turn/start") {
      lastTurnStart = event.seq;
    }
    if (event.type === "turn/end") {
      lastTurnEnd = event.seq;
    }
    if (event.type === "user/message" || event.type === "bot/message") {
      lastInput = event.seq;
    }
  }
  if (lastInput === 0) {
    return false;
  }
  if (lastTurnStart === 0) {
    return true;
  }
  if (lastTurnEnd < lastTurnStart) {
    return false;
  }
  return lastInput > lastTurnStart;
}

export function titleFromText(text: string): string {
  const oneLine = text.trim().split(/\r?\n/, 1)[0] ?? "";
  if (oneLine.length <= 40) {
    return oneLine || "새 세션";
  }
  return `${oneLine.slice(0, 40)}…`;
}
