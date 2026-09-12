/**
 * GitHub webhook receiver: CI failures and PR review/issue comments inject
 * context into an existing worktree session and queue one lead turn.
 * No session creation, merge, or force-push.
 */
import {
  GithubWebhookStore,
  formatCiFailureReworkContext,
  formatReviewReworkContext,
  githubWebhookDbPath,
  loadGithubWebhookSecret,
  normalizePrUrl,
  resolveGithubRepo,
  verifyGithubWebhookSignature,
} from "@cbot/agent";
import { sessionProject, type SessionId, type SessionSummary } from "@cbot/shared";
import { acceptUserMessage, type Runtime } from "./runtime.ts";

export type WebhookHandleResult = {
  status: number;
  body: Record<string, unknown>;
};

type Actionable = {
  kind: "review" | "ci";
  owner: string;
  repo: string;
  branch?: string;
  prUrl?: string;
  text: string;
};

const stores = new Map<string, GithubWebhookStore>();

async function webhookStore(home: string): Promise<GithubWebhookStore> {
  let store = stores.get(home);
  if (!store) {
    store = await GithubWebhookStore.open(githubWebhookDbPath(home));
    stores.set(home, store);
  }
  return store;
}

/** Test helper: drop the cached store so a fresh CBOT_HOME is used. */
export function resetGithubWebhookStoresForTests(): void {
  for (const store of stores.values()) {
    store.close();
  }
  stores.clear();
}

export async function handleGithubWebhook(req: Request, runtime: Runtime): Promise<Response> {
  const result = await processGithubWebhook(req, runtime);
  return Response.json(result.body, { status: result.status });
}

export async function processGithubWebhook(
  req: Request,
  runtime: Runtime,
): Promise<WebhookHandleResult> {
  const rawBody = await req.text();
  const secret = await loadGithubWebhookSecret(runtime.env.home);
  const signature = req.headers.get("x-hub-signature-256");

  // Secret unset ≡ missing signature → ignore, zero side effects.
  if (!secret || !verifyGithubWebhookSignature(secret, rawBody, signature)) {
    return { status: 401, body: { ok: false, error: "invalid signature" } };
  }

  const deliveryId = req.headers.get("x-github-delivery")?.trim() ?? "";
  const event = req.headers.get("x-github-event")?.trim() ?? "";
  const store = await webhookStore(runtime.env.home);

  // Duplicate check only — claim after a successful queue so GitHub retries
  // still work if inject/parse fails mid-flight.
  if (deliveryId && store.hasDelivery(deliveryId)) {
    return { status: 200, body: { ok: true, duplicate: true, deliveryId } };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return { status: 400, body: { ok: false, error: "invalid json" } };
  }

  const actionable = parseActionable(event, payload);
  if (!actionable) {
    return { status: 200, body: { ok: true, ignored: true, reason: "not_actionable", event } };
  }

  const session = await findMappedSession(runtime, store, actionable);
  if (!session) {
    console.info(
      `[github-webhook] no mapped session event=${event} branch=${actionable.branch ?? "-"} pr=${actionable.prUrl ?? "-"} repo=${actionable.owner}/${actionable.repo}`,
    );
    return {
      status: 200,
      body: {
        ok: true,
        ignored: true,
        reason: "no_session",
        branch: actionable.branch ?? null,
        prUrl: actionable.prUrl ?? null,
      },
    };
  }

  if (actionable.prUrl) {
    store.rememberPrSession(actionable.prUrl, session.id, actionable.branch ?? session.worktree?.branch);
  }

  // Direct acceptUserMessage — never slash-command parsing — so `/issue` in a
  // comment body cannot open a new session or trigger auto-write.
  try {
    await acceptUserMessage(runtime, session.id, actionable.text);
  } catch (error) {
    console.info(
      `[github-webhook] inject failed delivery=${deliveryId || "-"} session=${session.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { status: 500, body: { ok: false, error: "inject_failed" } };
  }

  if (deliveryId) {
    store.claimDelivery(deliveryId);
  }

  return {
    status: 200,
    body: {
      ok: true,
      queued: true,
      sessionId: session.id,
      kind: actionable.kind,
      branch: session.worktree?.branch ?? null,
    },
  };
}

function parseActionable(event: string, payload: unknown): Actionable | null {
  if (!isRecord(payload)) {
    return null;
  }
  const repoInfo = repoFromPayload(payload);
  if (!repoInfo) {
    return null;
  }

  if (event === "pull_request_review_comment") {
    const action = typeof payload.action === "string" ? payload.action : "";
    if (action && action !== "created") {
      return null;
    }
    const comment = isRecord(payload.comment) ? payload.comment : null;
    const pr = isRecord(payload.pull_request) ? payload.pull_request : null;
    if (!comment || !pr) {
      return null;
    }
    const body = typeof comment.body === "string" ? comment.body : "";
    const path = typeof comment.path === "string" ? comment.path : undefined;
    const line =
      typeof comment.line === "number"
        ? comment.line
        : typeof comment.original_line === "number"
          ? comment.original_line
          : null;
    const head = isRecord(pr.head) ? pr.head : null;
    const branch = typeof head?.ref === "string" ? head.ref : undefined;
    const prUrl = typeof pr.html_url === "string" ? pr.html_url : undefined;
    const commentUrl = typeof comment.html_url === "string" ? comment.html_url : undefined;
    const user = isRecord(comment.user) && typeof comment.user.login === "string" ? comment.user.login : undefined;
    return {
      kind: "review",
      ...repoInfo,
      ...(branch ? { branch } : {}),
      ...(prUrl ? { prUrl } : {}),
      text: formatReviewReworkContext({
        body,
        line,
        ...(prUrl ? { prUrl } : {}),
        ...(path ? { path } : {}),
        ...(commentUrl ? { commentUrl } : {}),
        ...(user ? { author: user } : {}),
      }),
    };
  }

  if (event === "issue_comment") {
    const action = typeof payload.action === "string" ? payload.action : "";
    if (action && action !== "created") {
      return null;
    }
    const issue = isRecord(payload.issue) ? payload.issue : null;
    const comment = isRecord(payload.comment) ? payload.comment : null;
    // Non-PR issue comments are ignored.
    if (!issue || !comment || !isRecord(issue.pull_request)) {
      return null;
    }
    const body = typeof comment.body === "string" ? comment.body : "";
    const prUrl =
      typeof issue.html_url === "string"
        ? issue.html_url
        : typeof issue.pull_request.html_url === "string"
          ? issue.pull_request.html_url
          : undefined;
    const commentUrl = typeof comment.html_url === "string" ? comment.html_url : undefined;
    const user = isRecord(comment.user) && typeof comment.user.login === "string" ? comment.user.login : undefined;
    return {
      kind: "review",
      ...repoInfo,
      ...(prUrl ? { prUrl } : {}),
      text: formatReviewReworkContext({
        body,
        ...(prUrl ? { prUrl } : {}),
        ...(commentUrl ? { commentUrl } : {}),
        ...(user ? { author: user } : {}),
      }),
    };
  }

  if (event === "check_suite" || event === "workflow_run") {
    const action = typeof payload.action === "string" ? payload.action : "";
    if (action && action !== "completed") {
      return null;
    }
    const node =
      event === "check_suite"
        ? isRecord(payload.check_suite)
          ? payload.check_suite
          : null
        : isRecord(payload.workflow_run)
          ? payload.workflow_run
          : null;
    if (!node) {
      return null;
    }
    const conclusion = typeof node.conclusion === "string" ? node.conclusion : "";
    // Success / cancelled / neutral / skipped → no turn.
    if (conclusion !== "failure" && conclusion !== "timed_out") {
      return null;
    }
    const branch =
      typeof node.head_branch === "string"
        ? node.head_branch
        : typeof payload.head_branch === "string"
          ? payload.head_branch
          : undefined;
    const name =
      typeof node.name === "string"
        ? node.name
        : typeof node.display_title === "string"
          ? node.display_title
          : event;
    const htmlUrl = typeof node.html_url === "string" ? node.html_url : undefined;
    const prUrl = firstPrUrl(node) ?? firstPrUrl(payload);
    const summary =
      typeof node.output === "object" &&
      node.output &&
      typeof (node.output as { summary?: unknown }).summary === "string"
        ? (node.output as { summary: string }).summary
        : typeof node.display_title === "string"
          ? node.display_title
          : undefined;
    return {
      kind: "ci",
      ...repoInfo,
      ...(branch ? { branch } : {}),
      ...(prUrl ? { prUrl } : {}),
      text: formatCiFailureReworkContext({
        name,
        conclusion,
        ...(prUrl ? { prUrl } : {}),
        ...(branch ? { branch } : {}),
        ...(htmlUrl ? { htmlUrl } : {}),
        ...(summary ? { summary } : {}),
      }),
    };
  }

  return null;
}

async function findMappedSession(
  runtime: Runtime,
  store: GithubWebhookStore,
  actionable: Actionable,
): Promise<SessionSummary | null> {
  const coding = runtime.store.list({ kind: "coding" });

  if (actionable.prUrl) {
    const mappedId = store.sessionIdForPr(actionable.prUrl);
    if (mappedId) {
      const session = runtime.store.get(mappedId);
      if (session && (await sessionMatchesRepo(session, actionable.owner, actionable.repo))) {
        return session;
      }
    }
    for (const session of coding) {
      if (!session.worktree) {
        continue;
      }
      if (!(await sessionMatchesRepo(session, actionable.owner, actionable.repo))) {
        continue;
      }
      if (sessionMentionsPr(runtime, session.id, actionable.prUrl)) {
        return session;
      }
    }
  }

  if (actionable.branch) {
    for (const session of coding) {
      if (session.worktree?.branch !== actionable.branch) {
        continue;
      }
      if (await sessionMatchesRepo(session, actionable.owner, actionable.repo)) {
        return session;
      }
    }
  }

  return null;
}

async function sessionMatchesRepo(
  session: SessionSummary,
  owner: string,
  repo: string,
): Promise<boolean> {
  const project = sessionProject(session);
  if (!project) {
    return false;
  }
  const remote = await resolveGithubRepo(project);
  if (!remote) {
    return false;
  }
  return (
    remote.owner.toLowerCase() === owner.toLowerCase() &&
    remote.repo.toLowerCase() === repo.toLowerCase()
  );
}

function sessionMentionsPr(runtime: Runtime, sessionId: SessionId, prUrl: string): boolean {
  const needle = normalizePrUrl(prUrl);
  if (!needle) {
    return false;
  }
  for (const event of runtime.store.events(sessionId)) {
    if (event.type !== "tool/result" && event.type !== "assistant/message" && event.type !== "user/message") {
      continue;
    }
    const text =
      event.type === "tool/result"
        ? event.content
        : event.type === "assistant/message" || event.type === "user/message"
          ? event.text
          : "";
    if (typeof text === "string" && normalizePrUrl(text.includes("http") ? extractPrUrl(text) ?? "" : "") === needle) {
      return true;
    }
    if (typeof text === "string" && text.toLowerCase().includes(needle)) {
      return true;
    }
  }
  return false;
}

function extractPrUrl(text: string): string | null {
  const match = /https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/i.exec(text);
  return match ? match[0]! : null;
}

function repoFromPayload(payload: Record<string, unknown>): { owner: string; repo: string } | null {
  const repository = isRecord(payload.repository) ? payload.repository : null;
  if (!repository) {
    return null;
  }
  if (typeof repository.full_name === "string") {
    const [owner, repo] = repository.full_name.split("/");
    if (owner && repo) {
      return { owner, repo };
    }
  }
  const ownerObj = isRecord(repository.owner) ? repository.owner : null;
  const owner = typeof ownerObj?.login === "string" ? ownerObj.login : null;
  const repo = typeof repository.name === "string" ? repository.name : null;
  if (owner && repo) {
    return { owner, repo };
  }
  return null;
}

function firstPrUrl(node: Record<string, unknown>): string | undefined {
  const prs = node.pull_requests;
  if (!Array.isArray(prs) || prs.length === 0) {
    return undefined;
  }
  const first = prs[0];
  if (isRecord(first) && typeof first.html_url === "string") {
    return first.html_url;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
