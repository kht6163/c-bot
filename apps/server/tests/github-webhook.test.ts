import { createHmac } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  GithubWebhookStore,
  addWorktree,
  githubWebhookDbPath,
  loadConfig,
  saveConfig,
  saveGithubWebhookSecret,
  saveProviderKey,
  upsertProvider,
  type LlmClient,
  type LlmStreamEvent,
} from "@cbot/agent";
import { handleHttp } from "../src/http.ts";
import { loadProcessEnv } from "../src/env.ts";
import {
  createRuntime,
  isSessionBusy,
  type Runtime,
} from "../src/runtime.ts";
import { resetGithubWebhookStoresForTests } from "../src/github-webhook.ts";

class ScriptedLlm implements LlmClient {
  constructor(private readonly text: string) {}
  async *stream(): AsyncIterable<LlmStreamEvent> {
    yield { type: "text", text: this.text };
    yield { type: "done", finishReason: "stop" };
  }
}

class SlowLlm implements LlmClient {
  constructor(private readonly gate: { release: Promise<void> }) {}
  async *stream(): AsyncIterable<LlmStreamEvent> {
    await this.gate.release;
    yield { type: "text", text: "done" };
    yield { type: "done", finishReason: "stop" };
  }
}

type Harness = {
  runtime: Runtime;
  opts: { web: "none"; distDir: string; runtime: Runtime };
  home: string;
  sessionId: string;
  project: string;
  secret: string;
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

async function gitProject(owner = "octocat", repo = "Hello-World"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cbot-wh-repo-"));
  git(dir, "init", "-q", "-b", "main");
  await writeFile(join(dir, "README.md"), "hi\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  git(dir, "remote", "add", "origin", `https://github.com/${owner}/${repo}.git`);
  return dir;
}

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

async function harness(opts?: {
  project?: string;
  llm?: LlmClient;
  withWorktree?: boolean;
  secret?: string | null;
}): Promise<Harness> {
  resetGithubWebhookStoresForTests();
  const home = await mkdtemp(join(tmpdir(), "cbot-wh-home-"));
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
  const secret = opts?.secret === null ? "" : (opts?.secret ?? "whsec_test");
  if (secret) {
    await saveGithubWebhookSecret(home, secret);
  }
  const runtime = await createRuntime(env, opts?.llm ?? new ScriptedLlm("ok"));
  const httpOpts = { web: "none" as const, distDir: "/tmp", runtime };
  const workspace = opts?.project ?? (await gitProject());
  let sessionId: string;
  if (opts?.withWorktree !== false) {
    const added = await addWorktree({ home, project: workspace, branch: "cbot/issue-1" });
    const created = runtime.store.create({
      title: "#1 test",
      workspace: added.workspace,
      worktree: added.worktree,
    });
    sessionId = created.id;
  } else {
    const created = await handleHttp(
      new Request("http://127.0.0.1/api/sessions", {
        method: "POST",
        body: JSON.stringify({ workspace }),
      }),
      httpOpts,
    );
    const { session } = (await created.json()) as { session: { id: string } };
    sessionId = session.id;
  }
  return {
    runtime,
    opts: httpOpts,
    home,
    sessionId,
    project: workspace,
    secret: secret || "unused",
  };
}

async function postWebhook(
  h: Harness,
  event: string,
  payload: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = JSON.stringify(payload);
  const res = await handleHttp(
    new Request("http://127.0.0.1/api/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-github-delivery": headers?.["x-github-delivery"] ?? `deliv-${Math.random()}`,
        ...(h.secret && h.secret !== "unused"
          ? { "x-hub-signature-256": sign(h.secret, body) }
          : {}),
        ...headers,
      },
      body,
    }),
    h.opts,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function repoPayload(owner = "octocat", name = "Hello-World") {
  return {
    full_name: `${owner}/${name}`,
    name,
    owner: { login: owner },
  };
}

function reviewCommentPayload(overrides?: Record<string, unknown>) {
  return {
    action: "created",
    repository: repoPayload(),
    pull_request: {
      html_url: "https://github.com/octocat/Hello-World/pull/7",
      head: { ref: "cbot/issue-1" },
    },
    comment: {
      body: "Please rename this variable",
      path: "src/app.ts",
      line: 10,
      html_url: "https://github.com/octocat/Hello-World/pull/7#discussion_r1",
      user: { login: "reviewer" },
    },
    ...overrides,
  };
}

async function waitForTurnEnd(runtime: Runtime, sessionId: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const events = runtime.store.events(sessionId as never);
    if (events.some((e) => e.type === "turn/end")) {
      return;
    }
    await Bun.sleep(20);
  }
  throw new Error("turn did not end");
}

describe("POST /api/github/webhook", () => {
  test("bad signature has zero side effects", async () => {
    const h = await harness();
    const before = h.runtime.store.events(h.sessionId as never).length;
    const body = JSON.stringify(reviewCommentPayload());
    const res = await handleHttp(
      new Request("http://127.0.0.1/api/github/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request_review_comment",
          "x-github-delivery": "bad-sig-1",
          "x-hub-signature-256": sign("wrong-secret", body),
        },
        body,
      }),
      h.opts,
    );
    expect(res.status).toBe(401);
    expect(h.runtime.store.events(h.sessionId as never).length).toBe(before);
    h.runtime.store.close();
  });

  test("webhook secret unset ignores all (even with a signature)", async () => {
    const h = await harness({ secret: null });
    const before = h.runtime.store.events(h.sessionId as never).length;
    const body = JSON.stringify(reviewCommentPayload());
    const res = await handleHttp(
      new Request("http://127.0.0.1/api/github/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request_review_comment",
          "x-github-delivery": "no-secret-1",
          "x-hub-signature-256": sign("anything", body),
        },
        body,
      }),
      h.opts,
    );
    expect(res.status).toBe(401);
    expect(h.runtime.store.events(h.sessionId as never).length).toBe(before);
    h.runtime.store.close();
  });

  test("review comment injects context and queues a lead turn", async () => {
    const h = await harness();
    const result = await postWebhook(h, "pull_request_review_comment", reviewCommentPayload(), {
      "x-github-delivery": "ok-review-1",
    });
    expect(result.status).toBe(200);
    expect(result.body.queued).toBe(true);
    expect(result.body.sessionId).toBe(h.sessionId);
    await waitForTurnEnd(h.runtime, h.sessionId);
    const events = h.runtime.store.events(h.sessionId as never);
    const user = events.find((e) => e.type === "user/message");
    expect(user && "text" in user ? user.text : "").toContain("Please rename this variable");
    expect(user && "text" in user ? user.text : "").toContain("src/app.ts");
    expect(events.some((e) => e.type === "turn/start")).toBe(true);
    h.runtime.store.close();
  });

  test("no mapped session logs only — no turn", async () => {
    const h = await harness({ withWorktree: false });
    const before = h.runtime.store.list({ kind: "coding" }).length;
    const result = await postWebhook(h, "pull_request_review_comment", reviewCommentPayload(), {
      "x-github-delivery": "no-map-1",
    });
    expect(result.status).toBe(200);
    expect(result.body.ignored).toBe(true);
    expect(result.body.reason).toBe("no_session");
    expect(h.runtime.store.list({ kind: "coding" }).length).toBe(before);
    expect(h.runtime.store.events(h.sessionId as never).some((e) => e.type === "user/message")).toBe(
      false,
    );
    h.runtime.store.close();
  });

  test("same X-GitHub-Delivery is idempotent — at most one turn", async () => {
    const h = await harness();
    const first = await postWebhook(h, "pull_request_review_comment", reviewCommentPayload(), {
      "x-github-delivery": "same-deliv-1",
    });
    const second = await postWebhook(h, "pull_request_review_comment", reviewCommentPayload(), {
      "x-github-delivery": "same-deliv-1",
    });
    expect(first.body.queued).toBe(true);
    expect(second.body.duplicate).toBe(true);
    await waitForTurnEnd(h.runtime, h.sessionId);
    const users = h.runtime.store
      .events(h.sessionId as never)
      .filter((e) => e.type === "user/message");
    expect(users.length).toBe(1);
    h.runtime.store.close();
  });

  test("session busy → queue once", async () => {
    let release!: () => void;
    const gate = { release: new Promise<void>((r) => (release = r)) };
    const h = await harness({ llm: new SlowLlm(gate) });
    // Start a turn so the session is busy.
    await handleHttp(
      new Request(`http://127.0.0.1/api/sessions/${h.sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: "start working" }),
      }),
      h.opts,
    );
    for (let i = 0; i < 50 && !isSessionBusy(h.sessionId as never); i += 1) {
      await Bun.sleep(10);
    }
    expect(isSessionBusy(h.sessionId as never)).toBe(true);
    const result = await postWebhook(h, "pull_request_review_comment", reviewCommentPayload(), {
      "x-github-delivery": "busy-1",
    });
    expect(result.body.queued).toBe(true);
    const usersAfterInject = h.runtime.store
      .events(h.sessionId as never)
      .filter((e) => e.type === "user/message");
    expect(usersAfterInject.length).toBe(2);
    // Second webhook with new delivery while still busy still appends (new delivery),
    // but we only care busy path queued via wakeSession once for the first inject.
    release();
    await waitForTurnEnd(h.runtime, h.sessionId);
    // Allow follow-up turn for the webhook message.
    for (let i = 0; i < 100; i += 1) {
      const ends = h.runtime.store.events(h.sessionId as never).filter((e) => e.type === "turn/end");
      if (ends.length >= 2) break;
      await Bun.sleep(20);
    }
    const ends = h.runtime.store.events(h.sessionId as never).filter((e) => e.type === "turn/end");
    expect(ends.length).toBeGreaterThanOrEqual(2);
    h.runtime.store.close();
  });

  test("CI success and cancelled do not queue a turn", async () => {
    const h = await harness();
    for (const conclusion of ["success", "cancelled"]) {
      const result = await postWebhook(
        h,
        "workflow_run",
        {
          action: "completed",
          repository: repoPayload(),
          workflow_run: {
            name: "CI",
            conclusion,
            head_branch: "cbot/issue-1",
            html_url: "https://github.com/octocat/Hello-World/actions/runs/1",
          },
        },
        { "x-github-delivery": `ci-${conclusion}` },
      );
      expect(result.body.ignored).toBe(true);
    }
    expect(h.runtime.store.events(h.sessionId as never).some((e) => e.type === "user/message")).toBe(
      false,
    );
    h.runtime.store.close();
  });

  test("workflow_run failure injects CI context", async () => {
    const h = await harness();
    const result = await postWebhook(
      h,
      "workflow_run",
      {
        action: "completed",
        repository: repoPayload(),
        workflow_run: {
          name: "CI",
          conclusion: "failure",
          head_branch: "cbot/issue-1",
          html_url: "https://github.com/octocat/Hello-World/actions/runs/2",
          display_title: "tests failed on main checks",
        },
      },
      { "x-github-delivery": "ci-fail-1" },
    );
    expect(result.body.queued).toBe(true);
    await waitForTurnEnd(h.runtime, h.sessionId);
    const user = h.runtime.store.events(h.sessionId as never).find((e) => e.type === "user/message");
    expect(user && "text" in user ? user.text : "").toContain("CI 실패");
    expect(user && "text" in user ? user.text : "").toContain("failure");
    h.runtime.store.close();
  });

  test("non-PR issue_comment is ignored", async () => {
    const h = await harness();
    const result = await postWebhook(
      h,
      "issue_comment",
      {
        action: "created",
        repository: repoPayload(),
        issue: {
          number: 1,
          html_url: "https://github.com/octocat/Hello-World/issues/1",
          // no pull_request key
        },
        comment: { body: "hello", html_url: "https://github.com/octocat/Hello-World/issues/1#ic1" },
      },
      { "x-github-delivery": "issue-only-1" },
    );
    expect(result.body.ignored).toBe(true);
    expect(h.runtime.store.events(h.sessionId as never).some((e) => e.type === "user/message")).toBe(
      false,
    );
    h.runtime.store.close();
  });

  test("other repo does not map even with same branch name", async () => {
    const h = await harness();
    const result = await postWebhook(
      h,
      "pull_request_review_comment",
      reviewCommentPayload({
        repository: repoPayload("other", "repo"),
        pull_request: {
          html_url: "https://github.com/other/repo/pull/7",
          head: { ref: "cbot/issue-1" },
        },
      }),
      { "x-github-delivery": "other-repo-1" },
    );
    expect(result.body.reason).toBe("no_session");
    expect(h.runtime.store.events(h.sessionId as never).some((e) => e.type === "user/message")).toBe(
      false,
    );
    h.runtime.store.close();
  });

  test("comment containing /issue does not create a new session", async () => {
    const h = await harness();
    // Remember PR URL so issue_comment can map without head.ref.
    const store = await GithubWebhookStore.open(githubWebhookDbPath(h.home));
    store.rememberPrSession(
      "https://github.com/octocat/Hello-World/pull/7",
      h.sessionId as never,
      "cbot/issue-1",
    );
    store.close();
    resetGithubWebhookStoresForTests();

    const before = h.runtime.store.list({ kind: "coding" }).length;
    const result = await postWebhook(
      h,
      "issue_comment",
      {
        action: "created",
        repository: repoPayload(),
        issue: {
          number: 7,
          html_url: "https://github.com/octocat/Hello-World/pull/7",
          pull_request: {
            url: "https://api.github.com/repos/octocat/Hello-World/pulls/7",
            html_url: "https://github.com/octocat/Hello-World/pull/7",
          },
        },
        comment: {
          body: "/issue 99 please also look at this",
          html_url: "https://github.com/octocat/Hello-World/pull/7#ic2",
          user: { login: "alice" },
        },
      },
      { "x-github-delivery": "slash-issue-1" },
    );
    expect(result.body.queued).toBe(true);
    await waitForTurnEnd(h.runtime, h.sessionId);
    expect(h.runtime.store.list({ kind: "coding" }).length).toBe(before);
    expect(
      h.runtime.store.list({ kind: "coding" }).some((s) => s.worktree?.branch === "cbot/issue-99"),
    ).toBe(false);
    const user = h.runtime.store.events(h.sessionId as never).find((e) => e.type === "user/message");
    expect(user && "text" in user ? user.text : "").toContain("/issue 99");
    h.runtime.store.close();
  });
});
