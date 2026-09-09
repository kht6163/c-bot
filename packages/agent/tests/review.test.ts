import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { asToolCallId, newTurnId, type SessionId } from "@cbot/shared";
import { sessionReview } from "../src/session/review.ts";
import { SessionStore } from "../src/session/store.ts";

describe("session review activity", () => {
  let store: SessionStore;
  beforeEach(async () => {
    store = await SessionStore.open(":memory:");
  });
  afterEach(() => store.close());

  function record(id: SessionId, name: string, args: string, ok = true) {
    const turnId = newTurnId();
    const callId = asToolCallId("reused-provider-id");
    store.append(id, {
      type: "tool/call", turnId,
      call: { id: callId, name, arguments: args, ui: "generic" },
    });
    const result = { type: "tool/result" as const, turnId, callId, ok, content: "done" };
    store.append(id, result);
    return result;
  }

  test("combines normalized file activity from the coding session and its own hops", () => {
    const root = store.create({ workspace: "/workspace" });
    const hop = store.create({ kind: "bot-chat", parentId: root.id, workspace: "/workspace" });
    const other = store.create({ workspace: "/workspace" });
    const unrelatedHop = store.create({ kind: "bot-chat", parentId: other.id, workspace: "/workspace" });
    record(root.id, "write_file", '{"path":"src/../src/a.ts"}');
    record(hop.id, "edit_file", '{"path":"/workspace/src/a.ts"}');
    record(hop.id, "write_file", '{"path":"b.ts"}');
    record(root.id, "bash", '{"command":"bun test"}');
    record(hop.id, "bash", '{"command":"touch from-shell"}');
    record(other.id, "write_file", '{"path":"unrelated.ts"}');
    record(unrelatedHop.id, "write_file", '{"path":"unrelated-hop.ts"}');
    const expected = {
      files: [{ path: "b.ts", writes: 1, edits: 0 }, { path: "src/a.ts", writes: 1, edits: 1 }],
      shellCommands: 2,
    };
    expect(sessionReview(store, root.id)).toEqual(expected);
    expect(sessionReview(store, hop.id)).toEqual(expected);
  });

  test("ignores failed, pending, uncorrelated and duplicate results", () => {
    const root = store.create({ workspace: "/workspace" });
    const successful = record(root.id, "edit_file", '{"path":"a.ts"}');
    store.append(root.id, successful);
    record(root.id, "write_file", '{"path":"failed.ts"}', false);
    record(root.id, "bash", '{}', false);
    const turnId = newTurnId();
    const callId = asToolCallId("pending");
    store.append(root.id, { type: "tool/call", turnId, call: {
      id: callId, name: "write_file", arguments: '{"path":"pending.ts"}', ui: "diff",
    } });
    store.append(root.id, { type: "tool/result", turnId, callId, ok: true, content: "pending", pendingApproval: true });
    store.append(root.id, { type: "tool/result", turnId, callId: asToolCallId("missing"), ok: true, content: "wrote missing.ts" });
    expect(sessionReview(store, root.id)).toEqual({ files: [{ path: "a.ts", writes: 0, edits: 1 }], shellCommands: 0 });
    store.append(root.id, { type: "tool/result", turnId, callId, ok: true, content: "done" });
    expect(sessionReview(store, root.id).files).toHaveLength(2);
  });

  test("handles old and malformed arguments without attributing outside files", () => {
    const root = store.create({ workspace: "/workspace" });
    for (const args of ['{', 'null', '[]', '{}', '{"path":1}', '{"path":""}', '{"path":"."}', '{"path":"../outside"}', '{"path":"/workspace-other/a"}', '{"path":"a\\u0000b"}']) {
      record(root.id, "write_file", args);
    }
    record(root.id, "read_file", '{"path":"read.ts"}');
    store.append(root.id, { type: "context/clear" });
    expect(sessionReview(store, root.id)).toEqual({ files: [], shellCommands: 0 });
    record(root.id, "write_file", '{"path":"valid.ts"}');
    store.append(root.id, { type: "context/clear" });
    expect(sessionReview(store, root.id).files).toEqual([{ path: "valid.ts", writes: 1, edits: 0 }]);
  });
});
