import { describe, expect, test } from "bun:test";
import { runTurn, sessionNeedsTurn, titleFromText } from "../src/loop.ts";
import { SessionStore } from "../src/session/store.ts";
import type { LlmClient, LlmStreamEvent } from "../src/llm/client.ts";
import { LlmError } from "../src/llm/client.ts";
import { deriveMessages } from "../src/session/derive.ts";

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

describe("runTurn", () => {
  test("streams chunks then a final assistant message reconstructable from the log", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create();
    store.append(session.id, { type: "user/message", text: "ping", mentions: [] });
    await runTurn(session.id, {
      store,
      llm: new ScriptedLlm([
        { type: "text", text: "po" },
        { type: "text", text: "ng" },
        { type: "done", finishReason: "stop" },
      ]),
      apiKey: "test",
      baseURL: "https://api.x.ai/v1",
      model: "grok-4.6",
    });
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
    await runTurn(session.id, {
      store,
      llm: new ScriptedLlm([]),
      apiKey: undefined,
      baseURL: "https://api.x.ai/v1",
      model: "grok-4.6",
    });
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
    await runTurn(session.id, {
      store,
      llm: new ScriptedLlm(new LlmError("nope", "provider_auth_or_access")),
      apiKey: "test",
      baseURL: "https://api.x.ai/v1",
      model: "grok-4.6",
    });
    const message = store.events(session.id).find((e) => e.type === "assistant/message");
    expect(message?.type === "assistant/message" && message.text).toContain(
      "provider_auth_or_access",
    );
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
});
