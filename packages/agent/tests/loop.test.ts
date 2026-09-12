import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { asBotId, asDeliveryId, asSessionId, asToolCallId, asTurnId } from "@cbot/shared";
import { runTurn, sessionNeedsTurn, titleFromText, wokenByBot, type TurnContext } from "../src/loop.ts";
import { SessionStore } from "../src/session/store.ts";
import type { LlmClient, LlmRequest, LlmStreamEvent } from "../src/llm/client.ts";
import { LlmError } from "../src/llm/client.ts";
import { deriveMessages } from "../src/session/derive.ts";
import { ApprovalGate } from "../src/approval.ts";
import { readFileTool } from "../src/tools/fs.ts";
import { CODING_TOOLS } from "../src/tools/registry.ts";

class ScriptedLlm implements LlmClient {
  constructor(private readonly events: LlmStreamEvent[] | Error) {}

  async *stream(): AsyncIterable<LlmStreamEvent> {
    if (this.events instanceof Error) {
      throw this.events;
    }
    for (const event of this.events) {
      yield event;
    }
  }
}

/** Each call consumes the next script; an Error script throws. */
class SequencedLlm implements LlmClient {
  calls = 0;
  /** Tool names each call offered, in call order. */
  offered: string[][] = [];

  constructor(private readonly scripts: (LlmStreamEvent[] | Error)[]) {}

  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    this.offered.push((request.tools ?? []).map((tool) => tool.name));
    const script = this.scripts[this.calls] ?? this.scripts.at(-1) ?? [];
    this.calls += 1;
    if (script instanceof Error) {
      throw script;
    }
    for (const event of script) {
      yield event;
    }
  }
}

const OK_REPLY: LlmStreamEvent[] = [
  { type: "text", text: "done" },
  { type: "done", finishReason: "stop" },
];

function turnCtx(
  store: SessionStore,
  llm: LlmClient,
  extra: Partial<TurnContext> & Pick<TurnContext, "apiKey">,
): TurnContext {
  return {
    store,
    llm,
    baseURL: "https://llm.example/v1",
    model: "demo",
    workspace: extra.workspace ?? null,
    approvalMode: extra.approvalMode ?? "allow",
    approvals: extra.approvals ?? new ApprovalGate(),
    ...extra,
  };
}

describe("runTurn", () => {
  test("streams chunks then a final assistant message reconstructable from the log", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create();
    store.append(session.id, { type: "user/message", text: "ping", mentions: [] });
    await runTurn(
      session.id,
      turnCtx(
        store,
        new ScriptedLlm([
          { type: "text", text: "po" },
          { type: "text", text: "ng" },
          { type: "done", finishReason: "stop" },
        ]),
        { apiKey: "test" },
      ),
    );
    const events = store.events(session.id);
    expect(sessionNeedsTurn(events)).toBe(false);
    expect(deriveMessages(events)).toEqual([
      { role: "user", content: "ping" },
      { role: "assistant", content: "pong" },
    ]);
    expect(events.some((e) => e.type === "assistant/chunk")).toBe(true);
    store.close();
  });

  test("missing api key logs a missing_config assistant message", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create();
    store.append(session.id, { type: "user/message", text: "hi", mentions: [] });
    await runTurn(session.id, turnCtx(store, new ScriptedLlm([]), { apiKey: undefined }));
    const last = store.events(session.id).filter((e) => e.type === "assistant/message")[0];
    expect(last?.type).toBe("assistant/message");
    if (last?.type === "assistant/message") {
      expect(last.text).toContain("missing_config");
    }
    store.close();
  });

  test("LLM errors become a durable assistant message with a reason code", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create();
    store.append(session.id, { type: "user/message", text: "hi", mentions: [] });
    await runTurn(
      session.id,
      turnCtx(store, new ScriptedLlm(new LlmError("nope", "provider_auth_or_access")), {
        apiKey: "test",
      }),
    );
    const message = store.events(session.id).find((e) => e.type === "assistant/message");
    expect(message?.type === "assistant/message" && message.text).toContain(
      "provider_auth_or_access",
    );
    store.close();
  });
});

describe("transient retry", () => {
  test("a rate limit is retried once in the same session and the retry is logged", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create({ kind: "bot-chat", title: "Bot Chat" });
    store.append(session.id, { type: "user/message", text: "go", mentions: [] });
    const llm = new SequencedLlm([new LlmError("slow down", "provider_rate_limit"), OK_REPLY]);
    await runTurn(
      session.id,
      turnCtx(store, llm, { apiKey: "test", retry: { attempts: 1, delayMs: 0 } }),
    );
    const events = store.events(session.id);
    expect(llm.calls).toBe(2);
    expect(store.list()).toHaveLength(1);
    expect(events.filter((e) => e.type === "system/notice")).toHaveLength(1);
    expect(events.filter((e) => e.type === "turn/start")).toHaveLength(1);
    expect(deriveMessages(events)).toEqual([
      { role: "user", content: "go" },
      { role: "assistant", content: "done" },
    ]);
    store.close();
  });

  test("a second transient failure is real and ends the turn with its reason", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create({ kind: "bot-chat", title: "Bot Chat" });
    store.append(session.id, { type: "user/message", text: "go", mentions: [] });
    const llm = new SequencedLlm([
      new LlmError("500", "provider_server_error"),
      new LlmError("500 again", "provider_server_error"),
      OK_REPLY,
    ]);
    await runTurn(
      session.id,
      turnCtx(store, llm, { apiKey: "test", retry: { attempts: 1, delayMs: 0 } }),
    );
    const events = store.events(session.id);
    expect(llm.calls).toBe(2);
    expect(events.filter((e) => e.type === "system/notice")).toHaveLength(1);
    const message = events.find((e) => e.type === "assistant/message");
    expect(message?.type === "assistant/message" && message.text).toContain("provider_server_error");
    expect(sessionNeedsTurn(events)).toBe(false);
    store.close();
  });

  test("auth, quota, and config failures are never retried", async () => {
    for (const reason of ["provider_auth_or_access", "provider_quota_limit", "missing_config"] as const) {
      const store = await SessionStore.open(":memory:");
      const session = store.create({ kind: "bot-chat", title: "Bot Chat" });
      store.append(session.id, { type: "user/message", text: "go", mentions: [] });
      const llm = new SequencedLlm([new LlmError("no", reason), OK_REPLY]);
      await runTurn(
        session.id,
        turnCtx(store, llm, { apiKey: "test", retry: { attempts: 1, delayMs: 0 } }),
      );
      expect(llm.calls).toBe(1);
      expect(store.events(session.id).some((e) => e.type === "system/notice")).toBe(false);
      store.close();
    }
  });

  test("without a policy the first transient failure ends the turn", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create();
    store.append(session.id, { type: "user/message", text: "go", mentions: [] });
    const llm = new SequencedLlm([new LlmError("slow down", "provider_rate_limit"), OK_REPLY]);
    await runTurn(session.id, turnCtx(store, llm, { apiKey: "test" }));
    expect(llm.calls).toBe(1);
    store.close();
  });
});

describe("approval rules", () => {
  test("a rule remembered while the turn waits applies to the next call of the same turn", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "cbot-rule-"));
    const store = await SessionStore.open(":memory:");
    const session = store.create({ workspace });
    store.append(session.id, { type: "user/message", text: "run", mentions: [] });
    const llm = new SequencedLlm([
      [
        { type: "tool_call", id: "call_1", name: "bash", arguments: '{"command":"echo one"}' },
        { type: "done", finishReason: "tool_calls" },
      ],
      [
        { type: "tool_call", id: "call_2", name: "bash", arguments: '{"command":"echo two"}' },
        { type: "done", finishReason: "tool_calls" },
      ],
      OK_REPLY,
    ]);
    const approvals = new ApprovalGate();
    const rules: string[] = [];
    const turn = runTurn(
      session.id,
      turnCtx(store, llm, {
        apiKey: "test",
        workspace,
        approvalMode: "prompt",
        approvals,
        allowedCommands: () => rules,
      }),
    );
    await waitFor(() => approvals.ruleOf(asToolCallId("call_1")) !== undefined);
    expect(approvals.ruleOf(asToolCallId("call_1"))).toBe("echo");
    rules.push("echo");
    approvals.settle(asToolCallId("call_1"), true, session.id);
    await turn;
    const events = store.events(session.id);
    const pending = events.filter((e) => e.type === "tool/result" && e.pendingApproval);
    expect(pending).toHaveLength(1);
    expect(deriveMessages(events).filter((m) => m.role === "tool")).toHaveLength(2);
    store.close();
  });
});


describe("ApprovalGate session binding", () => {
  test("settle with the wrong session leaves the approval pending", async () => {
    const gate = new ApprovalGate();
    const callId = asToolCallId("call_cross");
    const sessionA = asSessionId("session-a");
    const sessionB = asSessionId("session-b");
    const waiting = gate.wait(callId, sessionA, undefined, "echo");
    expect(gate.settle(callId, true, sessionB)).toBe(false);
    expect(gate.ruleOf(callId)).toBe("echo");
    expect(gate.settle(callId, true, sessionA)).toBe(true);
    expect(await waiting).toBe(true);
    expect(gate.ruleOf(callId)).toBeUndefined();
  });
});

describe("coding tool choice", () => {
  test("offers and runs only the coding tools the turn allows", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "cbot-tools-"));
    const store = await SessionStore.open(":memory:");
    const limited = store.create({ workspace });
    store.append(limited.id, { type: "user/message", text: "run", mentions: [] });
    const llm = new SequencedLlm([
      [
        { type: "tool_call", id: "call_off", name: "bash", arguments: '{"command":"touch ran"}' },
        { type: "done", finishReason: "tool_calls" },
      ],
      OK_REPLY,
    ]);
    await runTurn(
      limited.id,
      turnCtx(store, llm, { apiKey: "test", workspace, codingTools: [readFileTool] }),
    );
    expect(llm.offered[0]).toEqual(["read_file"]);
    const result = store.events(limited.id).find((e) => e.type === "tool/result");
    expect(result?.type === "tool/result" && result.ok).toBe(false);
    expect(result?.type === "tool/result" && result.content).toContain("bash");
    expect(await Bun.file(join(workspace, "ran")).exists()).toBe(false);

    const open = store.create({ workspace });
    store.append(open.id, { type: "user/message", text: "hi", mentions: [] });
    const plain = new SequencedLlm([OK_REPLY]);
    await runTurn(open.id, turnCtx(store, plain, { apiKey: "test", workspace }));
    expect(plain.offered[0]).toEqual(CODING_TOOLS.map((tool) => tool.name));
    store.close();
  });
});

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (check()) {
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error("condition not met");
}

describe("wokenByBot", () => {
  test("is true only when the latest input is a teammate's message", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create();
    store.append(session.id, { type: "user/message", text: "a", mentions: [] });
    expect(wokenByBot(store.events(session.id))).toBe(false);
    store.append(session.id, {
      type: "bot/message",
      deliveryId: asDeliveryId("dlv_1"),
      fromBotId: asBotId("bot_1"),
      fromHandle: "researcher",
      fromTitle: "Researcher",
      text: "report",
    });
    expect(wokenByBot(store.events(session.id))).toBe(true);
    store.append(session.id, { type: "user/message", text: "b", mentions: [] });
    expect(wokenByBot(store.events(session.id))).toBe(false);
    store.close();
  });
});

describe("titleFromText", () => {
  test("truncates long first lines", () => {
    expect(titleFromText("short")).toBe("short");
    expect(titleFromText("x".repeat(50)).endsWith("…")).toBe(true);
  });
});

describe("sessionNeedsTurn", () => {
  test("is true after a user message and false after turn/end", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create();
    store.append(session.id, { type: "user/message", text: "a", mentions: [] });
    expect(sessionNeedsTurn(store.events(session.id))).toBe(true);
    store.close();
  });

  test("a mailbox delivery during a turn still owes a follow-up turn", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create();
    store.append(session.id, { type: "user/message", text: "a", mentions: [] });
    store.append(session.id, { type: "turn/start", turnId: asTurnId("trn_1") });
    store.append(session.id, {
      type: "bot/message",
      deliveryId: asDeliveryId("dlv_1"),
      fromBotId: asBotId("bot_1"),
      fromHandle: "researcher",
      fromTitle: "Researcher",
      text: "Message from 🤖 Researcher (@researcher):\n\nreport",
    });
    expect(sessionNeedsTurn(store.events(session.id))).toBe(false);
    store.append(session.id, { type: "turn/end", turnId: asTurnId("trn_1") });
    expect(sessionNeedsTurn(store.events(session.id))).toBe(true);
    store.close();
  });
});

class AbortingLlm implements LlmClient {
  constructor(
    private readonly before: LlmStreamEvent[],
    private readonly abort: () => void,
    private readonly after: LlmStreamEvent[] = [],
  ) {}

  async *stream(): AsyncIterable<LlmStreamEvent> {
    for (const event of this.before) {
      yield event;
    }
    this.abort();
    for (const event of this.after) {
      yield event;
    }
  }
}

describe("interrupting a turn", () => {
  test("keeps the streamed text, ends the turn as aborted, and runs no tool", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create({ workspace: "/tmp" });
    store.append(session.id, { type: "user/message", text: "긴 작업", mentions: [] });
    const controller = new AbortController();
    await runTurn(
      session.id,
      turnCtx(
        store,
        new AbortingLlm(
          [{ type: "text", text: "시작합" }],
          () => controller.abort(),
          [
            { type: "tool_call", id: "call-1", name: "bash", arguments: '{"command":"rm -rf /"}' },
            { type: "done", finishReason: "tool_calls" },
          ],
        ),
        { apiKey: "test", workspace: "/tmp", signal: controller.signal },
      ),
    );
    const events = store.events(session.id);
    const end = events.find((e) => e.type === "turn/end");
    expect(end?.type === "turn/end" && end.aborted).toBe(true);
    expect(events.some((e) => e.type === "tool/call")).toBe(false);
    expect(deriveMessages(events)).toEqual([
      { role: "user", content: "긴 작업" },
      { role: "assistant", content: "시작합" },
      { role: "user", content: "[사용자가 위 턴을 중단했습니다.]" },
    ]);
    expect(sessionNeedsTurn(events)).toBe(false);
    store.close();
  });

  test("an aborted turn owes the next queued message a turn", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create({ workspace: "/tmp" });
    store.append(session.id, { type: "user/message", text: "첫", mentions: [] });
    const controller = new AbortController();
    await runTurn(
      session.id,
      turnCtx(store, new AbortingLlm([], () => controller.abort()), {
        apiKey: "test",
        signal: controller.signal,
      }),
    );
    store.append(session.id, { type: "user/message", text: "둘", mentions: [] });
    expect(sessionNeedsTurn(store.events(session.id))).toBe(true);
    store.close();
  });

  test("a turn waiting on approval stops without executing the tool", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create({ workspace: "/tmp" });
    store.append(session.id, { type: "user/message", text: "지워", mentions: [] });
    const controller = new AbortController();
    const approvals = new ApprovalGate();
    const turn = runTurn(
      session.id,
      turnCtx(
        store,
        new ScriptedLlm([
          { type: "tool_call", id: "call-1", name: "bash", arguments: '{"command":"echo hi"}' },
          { type: "done", finishReason: "tool_calls" },
        ]),
        {
          apiKey: "test",
          workspace: "/tmp",
          approvalMode: "prompt",
          approvals,
          signal: controller.signal,
        },
      ),
    );
    for (let i = 0; i < 50; i++) {
      if (store.events(session.id).some((e) => e.type === "tool/result" && e.pendingApproval)) {
        break;
      }
      await Bun.sleep(5);
    }
    controller.abort();
    await turn;
    const events = store.events(session.id);
    const end = events.find((e) => e.type === "turn/end");
    expect(end?.type === "turn/end" && end.aborted).toBe(true);
    const results = events.filter((e) => e.type === "tool/result");
    expect(results.at(-1)).toMatchObject({ ok: false });
    // Every logged call still answers, so the derived history stays sendable.
    const derived = deriveMessages(events);
    const assistant = derived.find((message) => message.toolCalls);
    expect(assistant?.toolCalls).toHaveLength(1);
    expect(derived.filter((message) => message.role === "tool")).toHaveLength(1);
    store.close();
  });
});
