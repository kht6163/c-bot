import { describe, expect, test } from "bun:test";
import { asTurnId } from "@cbot/shared";
import { compactSession } from "../src/compact.ts";
import { LlmError, type LlmClient, type LlmRequest, type LlmStreamEvent } from "../src/llm/client.ts";
import { runTurn, type TurnContext } from "../src/loop.ts";
import { deriveMessages } from "../src/session/derive.ts";
import { SessionStore } from "../src/session/store.ts";
import { ApprovalGate } from "../src/approval.ts";

class SummarizerLlm implements LlmClient {
  readonly requests: LlmRequest[] = [];

  constructor(private readonly summary: string) {}

  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    this.requests.push(request);
    yield { type: "text", text: this.summary };
    yield { type: "done", finishReason: "stop" };
  }
}

class FailingLlm implements LlmClient {
  async *stream(): AsyncIterable<LlmStreamEvent> {
    throw new LlmError("too long", "context_overflow");
  }
}

/** Overflows once, then answers. */
class OverflowOnceLlm implements LlmClient {
  calls = 0;
  readonly seen: LlmRequest[] = [];

  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    this.calls += 1;
    this.seen.push(request);
    if (this.calls === 1) {
      throw new LlmError("too long", "context_overflow");
    }
    yield { type: "text", text: this.calls === 2 ? "요약" : "답" };
    yield { type: "done", finishReason: "stop" };
  }
}

async function seeded(): Promise<{ store: SessionStore; id: ReturnType<SessionStore["create"]>["id"] }> {
  const store = await SessionStore.open(":memory:");
  const session = store.create();
  for (const n of [1, 2, 3]) {
    const turnId = asTurnId(`turn-${n}`);
    store.append(session.id, { type: "user/message", text: `요청 ${n}`, mentions: [] });
    store.append(session.id, { type: "turn/start", turnId });
    store.append(session.id, { type: "assistant/message", turnId, text: `답 ${n}`, toolCalls: [] });
    store.append(session.id, { type: "turn/end", turnId });
  }
  return { store, id: session.id };
}

function ctx(store: SessionStore, llm: LlmClient, extra: Partial<TurnContext> = {}): TurnContext {
  return {
    store,
    llm,
    apiKey: "test",
    baseURL: "https://llm.example/v1",
    model: "demo",
    workspace: null,
    approvalMode: "allow",
    approvals: new ApprovalGate(),
    ...extra,
  };
}

describe("compactSession", () => {
  test("replaces the covered history with the summary and keeps the log intact", async () => {
    const { store, id } = await seeded();
    const llm = new SummarizerLlm("셋까지 했다");
    const result = await compactSession(id, {
      store,
      llm,
      apiKey: "test",
      baseURL: "https://llm.example/v1",
      model: "demo",
      keepRecentTurns: 0,
      auto: false,
    });
    expect(result.ok).toBe(true);
    const events = store.events(id);
    expect(events.filter((event) => event.type === "user/message")).toHaveLength(3);
    const messages = deriveMessages(events);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toContain("셋까지 했다");
    store.close();
  });

  test("keeping recent turns leaves them verbatim behind the summary", async () => {
    const { store, id } = await seeded();
    await compactSession(id, {
      store,
      llm: new SummarizerLlm("요약"),
      apiKey: "test",
      baseURL: "https://llm.example/v1",
      model: "demo",
      keepRecentTurns: 1,
      auto: true,
    });
    const messages = deriveMessages(store.events(id));
    expect(messages[0]?.content).toContain("요약");
    expect(messages.some((item) => item.content === "요청 3")).toBe(true);
    expect(messages.some((item) => item.content === "요청 1")).toBe(false);
    store.close();
  });

  test("the summarizer is asked without tools", async () => {
    const { store, id } = await seeded();
    const llm = new SummarizerLlm("요약");
    await compactSession(id, {
      store,
      llm,
      apiKey: "test",
      baseURL: "https://llm.example/v1",
      model: "demo",
      keepRecentTurns: 0,
      auto: false,
    });
    expect(llm.requests[0]?.tools).toBeUndefined();
    store.close();
  });

  test("a session with nothing behind the boundary is refused, not summarized", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create();
    store.append(session.id, { type: "user/message", text: "첫 요청", mentions: [] });
    const result = await compactSession(session.id, {
      store,
      llm: new SummarizerLlm("요약"),
      apiKey: "test",
      baseURL: "https://llm.example/v1",
      model: "demo",
      keepRecentTurns: 0,
      auto: false,
    });
    expect(result).toEqual({ ok: false, reason: "nothing_to_compact" });
    store.close();
  });

  test("a failed summary leaves the history untouched", async () => {
    const { store, id } = await seeded();
    const before = deriveMessages(store.events(id)).length;
    const result = await compactSession(id, {
      store,
      llm: new FailingLlm(),
      apiKey: "test",
      baseURL: "https://llm.example/v1",
      model: "demo",
      keepRecentTurns: 0,
      auto: true,
    });
    expect(result).toEqual({ ok: false, reason: "context_overflow" });
    expect(deriveMessages(store.events(id))).toHaveLength(before);
    store.close();
  });
});

describe("automatic compaction", () => {
  test("crossing the threshold compacts before the step runs", async () => {
    const { store, id } = await seeded();
    store.append(id, { type: "user/message", text: "다음 요청", mentions: [] });
    const llm = new SummarizerLlm("요약");
    await runTurn(
      id,
      ctx(store, llm, {
        context: { autoCompact: true, maxTokens: 10, compactAt: 0.8, keepRecentTurns: 0 },
      }),
    );
    const compacted = store.events(id).filter((event) => event.type === "context/compact");
    expect(compacted).toHaveLength(1);
    expect(compacted[0]?.type === "context/compact" && compacted[0].auto).toBe(true);
    store.close();
  });

  test("staying under the threshold compacts nothing", async () => {
    const { store, id } = await seeded();
    store.append(id, { type: "user/message", text: "다음 요청", mentions: [] });
    await runTurn(
      id,
      ctx(store, new SummarizerLlm("답"), {
        context: { autoCompact: true, maxTokens: 128000, compactAt: 0.8, keepRecentTurns: 2 },
      }),
    );
    expect(store.events(id).some((event) => event.type === "context/compact")).toBe(false);
    store.close();
  });

  test("a context_overflow from the provider compacts once and retries the step", async () => {
    const { store, id } = await seeded();
    store.append(id, { type: "user/message", text: "다음 요청", mentions: [] });
    const llm = new OverflowOnceLlm();
    await runTurn(
      id,
      ctx(store, llm, {
        context: { autoCompact: true, maxTokens: 128000, compactAt: 0.8, keepRecentTurns: 2 },
      }),
    );
    expect(llm.calls).toBe(3);
    expect(store.events(id).some((event) => event.type === "context/compact")).toBe(true);
    const answers = store
      .events(id)
      .filter((event) => event.type === "assistant/message" && event.text === "답");
    expect(answers).toHaveLength(1);
    store.close();
  });

  test("without the policy the loop never compacts on its own", async () => {
    const { store, id } = await seeded();
    store.append(id, { type: "user/message", text: "다음 요청", mentions: [] });
    await runTurn(id, ctx(store, new SummarizerLlm("답")));
    expect(store.events(id).some((event) => event.type === "context/compact")).toBe(false);
    store.close();
  });
});
