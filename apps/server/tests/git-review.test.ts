import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asToolCallId, newTurnId, type GitDiffView, type SessionId } from "@cbot/shared";
import type { LlmClient } from "@cbot/agent";
import { handleHttp } from "../src/http.ts";
import { loadProcessEnv } from "../src/env.ts";
import { createRuntime, type Runtime } from "../src/runtime.ts";

const fixtures: { root: string; runtime: Runtime }[] = [];
afterEach(async () => {
  for (const { root, runtime } of fixtures.splice(0)) {
    runtime.store.close();
    await rm(root, { recursive: true, force: true });
  }
});
async function git(root: string, ...args: string[]) {
  const proc = Bun.spawn(["git", ...args], { cwd: root, stdout: "ignore", stderr: "ignore" });
  return proc.exited;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cbot-review-http-"));
  const workspace = join(root, "repo");
  await mkdir(workspace);
  await git(workspace, "init", "-qb", "main");
  await git(workspace, "config", "user.email", "test@example.test");
  await git(workspace, "config", "user.name", "Test");
  await writeFile(join(workspace, "file.txt"), "original\n");
  await git(workspace, "add", ".");
  await git(workspace, "commit", "-qm", "initial");
  const llm: LlmClient = { async *stream() {} };
  const runtime = await createRuntime(loadProcessEnv({ CBOT_HOME: join(root, "home") }), llm, workspace);
  fixtures.push({ root, runtime });
  const session = runtime.store.create({ workspace });
  const get = (id: string, endpoint: string) => handleHttp(
    new Request(`http://127.0.0.1/api/sessions/${id}/git/${endpoint}`),
    { web: "none", distDir: "/tmp", runtime },
  );
  return { runtime, workspace, session, get };
}
function record(runtime: Runtime, id: SessionId, name: string, path: string) {
  const turnId = newTurnId();
  const callId = asToolCallId("call");
  runtime.store.append(id, { type: "tool/call", turnId,
    call: { id: callId, name, arguments: JSON.stringify({ path }), ui: "generic" } });
  runtime.store.append(id, { type: "tool/result", turnId, callId, ok: true, content: "done" });
}

test("diff HTTP endpoint returns the selected workspace file and rejects invalid requests", async () => {
  const { get, runtime, workspace, session } = await fixture();
  await writeFile(join(workspace, "file.txt"), "working\n");
  const response = await get(session.id, "diff?path=file.txt&scope=unstaged");
  expect(response.status).toBe(200);
  const body = await response.json() as { diff: GitDiffView };
  expect(body.diff.path).toBe("file.txt");
  expect(body.diff.patch).toContain("-original\n+working");
  expect(body.diff.truncated).toBe(false);
  for (const query of ["path=file.txt", "path=file.txt&scope=invalid", "path=../outside&scope=unstaged", "path=/etc/passwd&scope=untracked", "path=file.txt&scope=staged"]) {
    expect((await get(session.id, `diff?${query}`)).status).toBe(400);
  }
  const noWorkspace = runtime.store.create({ workspace: null });
  for (const endpoint of ["diff?path=file.txt&scope=unstaged", "review"]) {
    expect((await get(noWorkspace.id, endpoint)).status).toBe(400);
    expect((await get("missing", endpoint)).status).toBe(404);
  }
});

test("review HTTP endpoint includes only its coding session and hop activity", async () => {
  const { get, runtime, workspace, session } = await fixture();
  const hop = runtime.store.create({ kind: "bot-chat", parentId: session.id, workspace });
  const inheritedHop = runtime.store.create({ kind: "bot-chat", parentId: session.id, workspace: null });
  const separate = runtime.store.create({ workspace });
  record(runtime, session.id, "write_file", "file.txt");
  record(runtime, hop.id, "edit_file", "file.txt");
  record(runtime, inheritedHop.id, "edit_file", "file.txt");
  record(runtime, session.id, "bash", "");
  record(runtime, separate.id, "write_file", "unrelated.txt");
  const response = await get(session.id, "review");
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ review: { files: [{ path: "file.txt", writes: 1, edits: 2 }], shellCommands: 1 } });
  expect(await (await get(hop.id, "review")).json()).toEqual(body);
  await writeFile(join(workspace, "file.txt"), "changed\n");
  expect((await get(hop.id, "diff?path=file.txt&scope=unstaged")).status).toBe(200);
  expect((await get(inheritedHop.id, "diff?path=file.txt&scope=unstaged")).status).toBe(200);
});

test("unmerged working tree diff remains readable through HTTP", async () => {
  const { get, workspace, session } = await fixture();
  await git(workspace, "checkout", "-qb", "side");
  await writeFile(join(workspace, "file.txt"), "side\n");
  await git(workspace, "commit", "-qam", "side");
  await git(workspace, "checkout", "-q", "main");
  await writeFile(join(workspace, "file.txt"), "main\n");
  await git(workspace, "commit", "-qam", "main");
  expect(await git(workspace, "merge", "side")).toBe(1);
  const response = await get(session.id, "diff?path=file.txt&scope=unstaged");
  expect(response.status).toBe(200);
  const body = await response.json() as { diff: GitDiffView };
  expect(body.diff.patch).toContain("@@@");
  expect(body.diff.patch).toContain("<<<<<<< HEAD");
});
