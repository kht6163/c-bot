import { describe, expect, test } from "bun:test";
import { deriveMessages } from "../src/session/derive.ts";
import { SessionStore } from "../src/session/store.ts";
import { newTurnId } from "@cbot/shared";

describe("SessionStore", () => {
  test("create, append, and list in seq order", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create({ title: "one" });
    const turnId = newTurnId();
    store.append(session.id, { type: "user/message", text: "hi", mentions: [] });
    store.append(session.id, { type: "turn/start", turnId });
    store.append(session.id, { type: "assistant/chunk", turnId, text: "he" });
    store.append(session.id, { type: "assistant/chunk", turnId, text: "llo" });
    store.append(session.id, {
      type: "assistant/message",
      turnId,
      text: "hello",
      toolCalls: [],
    });
    store.append(session.id, { type: "turn/end", turnId });
    const events = store.events(session.id);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(store.list()[0]?.id).toBe(session.id);
    store.close();
  });

  test("onAppend fires for each event", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create();
    const types: string[] = [];
    store.onAppend((_id, event) => {
      types.push(event.type);
    });
    store.append(session.id, { type: "user/message", text: "a", mentions: [] });
    expect(types).toEqual(["user/message"]);
    store.close();
  });
});

describe("deriveMessages", () => {
  test("model history skips chunks and uses the final assistant message", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create();
    const turnId = newTurnId();
    store.append(session.id, { type: "user/message", text: "hi", mentions: [] });
    store.append(session.id, { type: "turn/start", turnId });
    store.append(session.id, { type: "assistant/chunk", turnId, text: "he" });
    store.append(session.id, {
      type: "assistant/message",
      turnId,
      text: "hello",
      toolCalls: [],
    });
    const messages = deriveMessages(store.events(session.id));
    expect(messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    store.close();
  });
});
