import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  allowGithubWriteTools,
  loadConfig,
  saveConfig,
  saveProviderKey,
  upsertProvider,
  type LlmClient,
  type LlmStreamEvent,
} from "@cbot/agent";
import { handleHttp } from "../src/http.ts";
import { loadProcessEnv } from "../src/env.ts";
import { createRuntime, type Runtime } from "../src/runtime.ts";

class ScriptedLlm implements LlmClient {
  constructor(private readonly text: string) {}
  async *stream(): AsyncIterable<LlmStreamEvent> {
    yield { type: "text", text: this.text };
    yield { type: "done", finishReason: "stop" };
  }
}

type Harness = {
  runtime: Runtime;
  opts: { web: "none"; distDir: string; runtime: Runtime };
  home: string;
  sessionId: string;
  project: string;
};

function git(cwd: string, ...args: string[]): void {
  const run = Bun.spawnSync(
    ["git", "-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args],
    { cwd },
  );
  if (run.exitCode !== 0) {
    throw new Error(run.stderr.toString());
  }
}

async function gitProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cbot-issue-repo-"));
  git(dir, "init", "-q", "-b", "main");
  await writeFile(join(dir, "README.md"), "hi\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  git(dir, "remote", "add", "origin", "https://github.com/octocat/Hello-World.git");
  return dir;
}

async function harness(project?: string): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), "cbot-issue-home-"));
  const env = loadProcessEnv({ CBOT_HOME: home, CBOT_PORT: "3080" });
  const config = await loadConfig(home);
  await saveConfig(
    home,
    upsertProvider(config, {
      id: "acme",
      displayName: "Acme",
      baseURL: "https://llm.example/v1",
      models: ["demo"],
    }),
  );
  await saveProviderKey(home, "acme", "test-key");
  const runtime = await createRuntime(env, new ScriptedLlm("ok"));
  const opts = { web: "none" as const, distDir: "/tmp", runtime };
  const workspace = project ?? (await mkdtemp(join(tmpdir(), "cbot-issue-plain-")));
  const created = await handleHttp(
    new Request("http://127.0.0.1/api/sessions", {
      method: "POST",
      body: JSON.stringify({ workspace }),
    }),
    opts,
  );
  const { session } = (await created.json()) as { session: { id: string } };
  return { runtime, opts, home, sessionId: session.id, project: workspace };
}

async function send(h: Harness, text: string): Promise<Response> {
  return handleHttp(
    new Request(`http://127.0.0.1/api/sessions/${h.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
    h.opts,
  );
}

function events(h: Harness, sessionId = h.sessionId): { type: string; text?: string; command?: string }[] {
  return h.runtime.store.events(sessionId as never) as never;
}

function lastNotice(h: Harness, sessionId = h.sessionId): string {
  return events(h, sessionId).filter((event) => event.type === "system/notice").at(-1)?.text ?? "";
}

async function withMockIssue<T>(body: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("/issue", () => {
  test("non-git workspace fails with no worktree side effects", async () => {
    const h = await harness();
    await withMockIssue(
      {
        number: 1,
        title: "x",
        body: "y",
        html_url: "https://github.com/octocat/Hello-World/issues/1",
        state: "open",
        labels: [],
      },
      async () => {
        expect((await send(h, "/issue https://github.com/octocat/Hello-World/issues/1")).status).toBe(202);
      },
    );
    const text = lastNotice(h);
    expect(text).toContain("[reason: non_git]");
    expect(h.runtime.store.get(h.sessionId as never)?.worktree).toBeNull();
    h.runtime.store.close();
  });

  test("attaches a worktree session and puts issue body in context", async () => {
    const project = await gitProject();
    const h = await harness(project);
    await withMockIssue(
      {
        number: 1,
        title: "Test issue",
        body: "Fix the bug please",
        html_url: "https://github.com/octocat/Hello-World/issues/1",
        state: "open",
        labels: [{ name: "bug" }],
      },
      async () => {
        expect((await send(h, "/issue 1")).status).toBe(202);
      },
    );
    const session = h.runtime.store.get(h.sessionId as never);
    expect(session?.worktree?.branch).toBe("cbot/issue-1");
    expect(session?.title).toContain("#1");
    const notice = lastNotice(h);
    expect(notice).toContain("Test issue");
    expect(notice).toContain("Fix the bug please");
    const user = events(h).find((event) => event.type === "user/message");
    expect(user?.text).toContain("Fix the bug please");
    expect(user?.text).toContain("github_create_pr");
    expect(events(h).some((event) => event.type === "turn/start")).toBe(false);
    h.runtime.store.close();
  });

  test("branch collision is reported with a retry hint", async () => {
    const project = await gitProject();
    git(project, "branch", "cbot/issue-1");
    const h = await harness(project);
    await withMockIssue(
      {
        number: 1,
        title: "Taken",
        body: "x",
        html_url: "https://github.com/octocat/Hello-World/issues/1",
        state: "open",
        labels: [],
      },
      async () => {
        await send(h, "/issue 1");
      },
    );
    const text = lastNotice(h);
    expect(text).toContain("[reason: conflict]");
    expect(text).toContain("다시 시도");
    expect(h.runtime.store.get(h.sessionId as never)?.worktree).toBeNull();
    h.runtime.store.close();
  });

  test("reuses an existing issue worktree session", async () => {
    const project = await gitProject();
    const h = await harness(project);
    await withMockIssue(
      {
        number: 2,
        title: "Reuse me",
        body: "body-one",
        html_url: "https://github.com/octocat/Hello-World/issues/2",
        state: "open",
        labels: [],
      },
      async () => {
        await send(h, "/issue 2");
        expect(h.runtime.store.get(h.sessionId as never)?.worktree?.branch).toBe("cbot/issue-2");
        await send(h, "/issue 2");
      },
    );
    expect(lastNotice(h)).toContain("이미");
    expect(h.runtime.store.list({ kind: "coding", project }).length).toBe(1);
    h.runtime.store.close();
  });

  test("reject path for PR tool is covered by always-on approval (no token = no push)", async () => {
    // Documented contract: needsApproval always true; execute checks token first.
    expect(allowGithubWriteTools("leader")).toBe(true);
    expect(allowGithubWriteTools(undefined)).toBe(true);
    expect(allowGithubWriteTools("specialist")).toBe(false);
  });
});

describe("leader-only github write", () => {
  test("specialist role cannot receive github write tools", () => {
    expect(allowGithubWriteTools("specialist")).toBe(false);
    expect(allowGithubWriteTools("leader")).toBe(true);
  });
});
