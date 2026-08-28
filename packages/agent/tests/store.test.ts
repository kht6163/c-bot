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

  test("round-trips assistant/thinking events", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create();
    const turnId = newTurnId();
    store.append(session.id, { type: "user/message", text: "hi", mentions: [] });
    store.append(session.id, { type: "turn/start", turnId });
    store.append(session.id, { type: "assistant/thinking", turnId, text: "plan" });
    store.append(session.id, {
      type: "assistant/message",
      turnId,
      text: "hello",
      toolCalls: [],
    });
    const events = store.events(session.id);
    expect(events.map((event) => event.type)).toEqual([
      "user/message",
      "turn/start",
      "assistant/thinking",
      "assistant/message",
    ]);
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

  test("list can filter coding sessions by workspace", async () => {
    const store = await SessionStore.open(":memory:");
    store.create({ title: "a", workspace: "/tmp/alpha" });
    store.create({ title: "b", workspace: "/tmp/beta" });
    const onlyAlpha = store.list({ kind: "coding", workspace: "/tmp/alpha" });
    expect(onlyAlpha.map((s) => s.title)).toEqual(["a"]);
    store.close();
  });

  test("delete removes events and the session row", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create({ title: "gone", workspace: "/tmp/alpha" });
    store.append(session.id, { type: "user/message", text: "hi", mentions: [] });
    expect(store.delete(session.id)).toBe(true);
    expect(store.get(session.id)).toBeUndefined();
    expect(store.events(session.id)).toEqual([]);
    expect(store.delete(session.id)).toBe(false);
    store.close();
  });

  test("deleteCodingByWorkspace leaves bot-chat sessions", async () => {
    const store = await SessionStore.open(":memory:");
    const coding = store.create({ title: "code", workspace: "/tmp/alpha" });
    store.create({ title: "other", workspace: "/tmp/beta" });
    const mailbox = store.create({ kind: "bot-chat", title: "Bot Chat", workspace: "/tmp/alpha" });
    const removed = store.deleteCodingByWorkspace("/tmp/alpha");
    expect(removed).toEqual([coding.id]);
    expect(store.get(coding.id)).toBeUndefined();
    expect(store.get(mailbox.id)?.kind).toBe("bot-chat");
    expect(store.list({ kind: "coding" }).map((session) => session.title)).toEqual(["other"]);
    store.close();
  });

  test("hop mailboxes belong to a parent coding session and die with it", async () => {
    const store = await SessionStore.open(":memory:");
    const coding = store.create({ title: "code", workspace: "/tmp/alpha" });
    const hop = store.create({
      kind: "bot-chat",
      title: "@researcher",
      parentId: coding.id,
      workspace: "/tmp/alpha",
    });
    const canonical = store.create({ kind: "bot-chat", title: "Bot Chat" });
    expect(store.list({ parentId: coding.id }).map((session) => session.id)).toEqual([hop.id]);
    expect(store.delete(coding.id)).toBe(true);
    expect(store.get(hop.id)).toBeUndefined();
    expect(store.get(canonical.id)?.title).toBe("Bot Chat");
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

  test("appends referenced file contents for the model", async () => {
    const store = await SessionStore.open(":memory:");
    const session = store.create();
    store.append(session.id, {
      type: "user/message",
      text: "see @note.txt",
      mentions: [],
      files: [{ path: "note.txt", content: "hello file" }],
    });
    expect(deriveMessages(store.events(session.id))[0]?.content).toContain("hello file");
    expect(deriveMessages(store.events(session.id))[0]?.content).toContain("note.txt");
    store.close();
  });
});
