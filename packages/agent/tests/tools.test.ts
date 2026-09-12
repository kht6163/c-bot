import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { readFileTool, writeFileTool, editFileTool, listDirTool } from "../src/tools/fs.ts";
import { grepTool, globTool } from "../src/tools/search.ts";
import { resolveWorkspacePath } from "../src/tools/path.ts";
import { bashTool, scrubEnv } from "../src/tools/bash.ts";
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

  test("rejects symlink escape outside the workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "cbot-symlink-ws-"));
    const outside = await mkdtemp(join(tmpdir(), "cbot-symlink-out-"));
    await writeFile(join(outside, "secret.txt"), "nope");
    await mkdir(join(workspace, "safe"), { recursive: true });
    const link = join(workspace, "escape");
    await symlink(outside, link);
    expect(() => resolveWorkspacePath(workspace, "escape/secret.txt")).toThrow(/escapes/);
    await expect(writeFileTool.execute({ path: "escape/pwned.txt", content: "x" }, ctx(workspace))).rejects.toThrow(
      /escapes/,
    );
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

  test("an allowed prefix skips the card only for commands that match it", () => {
    const prompt = { workspace: "/tmp", approvalMode: "prompt" as const, allowedCommands: ["bun test"] };
    expect(bashTool.needsApproval({ command: "bun test packages/agent" }, prompt)).toBe(false);
    expect(bashTool.needsApproval({ command: "bun test && rm -rf ." }, prompt)).toBe(true);
    expect(bashTool.needsApproval({ command: "bun run dev" }, prompt)).toBe(true);
  });

  test("offers the command prefix as the rule an approval can remember", () => {
    expect(bashTool.approvalRule?.({ command: "git status --short" })).toBe("git status");
    expect(bashTool.approvalRule?.({ command: "" })).toBeUndefined();
  });

  test("an allowed prefix does not cover a backgrounded second command", () => {
    const prompt = { workspace: "/tmp", approvalMode: "prompt" as const, allowedCommands: ["echo"] };
    expect(bashTool.needsApproval({ command: "echo hi & rm -rf /" }, prompt)).toBe(true);
  });

  test("scrubEnv drops API keys and tokens from the child environment", () => {
    const cleaned = scrubEnv({
      PATH: "/usr/bin",
      OPENAI_API_KEY: "sk-secret",
      GH_TOKEN: "ghp_x",
      MY_SECRET: "x",
      HOME: "/home/box",
    });
    expect(cleaned.PATH).toBe("/usr/bin");
    expect(cleaned.HOME).toBe("/home/box");
    expect(cleaned.OPENAI_API_KEY).toBeUndefined();
    expect(cleaned.GH_TOKEN).toBeUndefined();
    expect(cleaned.MY_SECRET).toBeUndefined();
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
      baseURL: "https://llm.example/v1",
      model: "demo",
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
