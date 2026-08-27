import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { readFileTool, writeFileTool, editFileTool, listDirTool } from "../src/tools/fs.ts";
import { grepTool, globTool } from "../src/tools/search.ts";
import { resolveWorkspacePath } from "../src/tools/path.ts";
import { bashTool } from "../src/tools/bash.ts";
import { findTool } from "../src/tools/registry.ts";
import { ApprovalGate } from "../src/approval.ts";
import { runTurn } from "../src/loop.ts";
import { SessionStore } from "../src/session/store.ts";
import { deriveMessages } from "../src/session/derive.ts";
import type { LlmClient, LlmStreamEvent } from "../src/llm/client.ts";

const ctx = (workspace: string) => ({ workspace, approvalMode: "allow" as const });

describe("workspace paths", () => {
  test("rejects parent traversal", () => {
    expect(() => resolveWorkspacePath("/tmp/ws", "../secret")).toThrow(/escapes/);
  });
});

describe("fs tools", () => {
  test("write, read, edit, list, grep, glob", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "cbot-ws-"));
    await writeFileTool.execute({ path: "src/a.ts", content: "hello world" }, ctx(workspace));
    const read = await readFileTool.execute({ path: "src/a.ts" }, ctx(workspace));
    expect(read).toBe("hello world");
    await editFileTool.execute(
      { path: "src/a.ts", old_string: "world", new_string: "c-bot" },
      ctx(workspace),
    );
    expect(await readFileTool.execute({ path: "src/a.ts" }, ctx(workspace))).toBe("hello c-bot");
    const listing = await listDirTool.execute({ path: "src" }, ctx(workspace));
    expect(listing).toContain("a.ts");
    const grepped = await grepTool.execute({ pattern: "c-bot" }, ctx(workspace));
    expect(grepped).toContain("src/a.ts:1:");
    const globbed = await globTool.execute({ pattern: "**/*.ts" }, ctx(workspace));
    expect(globbed).toContain("src/a.ts");
  });
});

describe("bash", () => {
  test("runs in the workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "cbot-bash-"));
    const out = await bashTool.execute({ command: "pwd" }, ctx(workspace));
    expect(out).toContain(workspace);
  });

  test("needs approval when mode is prompt", () => {
    expect(bashTool.needsApproval({ command: "ls" }, { workspace: "/tmp", approvalMode: "prompt" })).toBe(
      true,
    );
    expect(bashTool.needsApproval({ command: "ls" }, { workspace: "/tmp", approvalMode: "allow" })).toBe(
      false,
    );
  });
});

class SequenceLlm implements LlmClient {
  constructor(private readonly steps: LlmStreamEvent[][]) {}
  private i = 0;
  async *stream(): AsyncIterable<LlmStreamEvent> {
    const step = this.steps[this.i] ?? [];
    this.i += 1;
    for (const event of step) {
      yield event;
    }
  }
}

describe("runTurn with tools", () => {
  test("executes a tool call then a final assistant message", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "cbot-turn-"));
    await mkdir(join(workspace, "src"), { recursive: true });
    await writeFile(join(workspace, "src", "a.ts"), "ok", "utf8");
    const store = await SessionStore.open(":memory:");
    const session = store.create({ workspace });
    store.append(session.id, { type: "user/message", text: "read a.ts", mentions: [] });
    await runTurn(session.id, {
      store,
      llm: new SequenceLlm([
        [
          {
            type: "tool_call",
            id: "call_1",
            name: "read_file",
            arguments: JSON.stringify({ path: "src/a.ts" }),
          },
          { type: "done", finishReason: "tool_calls" },
        ],
        [
          { type: "text", text: "it says ok" },
          { type: "done", finishReason: "stop" },
        ],
      ]),
      apiKey: "test",
      baseURL: "https://api.x.ai/v1",
      model: "grok-4.6",
      workspace,
      approvalMode: "allow",
      approvals: new ApprovalGate(),
    });
    const messages = deriveMessages(store.events(session.id));
    expect(messages.some((m) => m.role === "tool" && m.content === "ok")).toBe(true);
    expect(messages.at(-1)).toEqual({ role: "assistant", content: "it says ok" });
    expect(findTool("read_file")?.ui).toBe("generic");
    store.close();
  });
});
