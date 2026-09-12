/**
 * GitHub issue fetch and draft-PR helpers. Tokens live only under $CBOT_HOME/.env
 * (GITHUB_TOKEN). Never return or log the raw token.
 */
import { chmod } from "node:fs/promises";
import { secretsPath } from "./config.ts";

export const GITHUB_TOKEN_ENV = "GITHUB_TOKEN";

export interface GithubIssueRef {
  owner: string;
  repo: string;
  number: number;
}

export interface GithubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  htmlUrl: string;
  owner: string;
  repo: string;
  state: string;
}

export type GithubErrorCode =
  | "auth"
  | "permission"
  | "not_found"
  | "conflict"
  | "network"
  | "invalid"
  | "non_git";

export class GithubError extends Error {
  constructor(
    readonly code: GithubErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "GithubError";
  }
}

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; method?: string; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

/** Parse `owner/repo#n`, a github.com issue URL, or a bare number (needs defaultRepo). */
export function parseIssueRef(
  raw: string,
  defaultRepo?: { owner: string; repo: string } | null,
): GithubIssueRef {
  const text = raw.trim();
  if (text.length === 0) {
    throw new GithubError("invalid", "이슈 번호나 URL이 필요합니다", "/issue <url|번호> 로 다시 시도하세요.");
  }

  const url = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[/?#]|$)/i.exec(text);
  if (url) {
    return { owner: url[1]!, repo: stripGit(url[2]!), number: Number(url[3]) };
  }

  const shorthand = /^([^/\s#]+)\/([^/\s#]+)#(\d+)$/.exec(text);
  if (shorthand) {
    return { owner: shorthand[1]!, repo: stripGit(shorthand[2]!), number: Number(shorthand[3]) };
  }

  const bare = /^#?(\d+)$/.exec(text);
  if (bare) {
    if (!defaultRepo) {
      throw new GithubError(
        "invalid",
        "저장소의 GitHub remote를 찾지 못해 이슈 번호만으로는 열 수 없습니다",
        "전체 URL이나 owner/repo#번호 형식으로 다시 시도하세요.",
      );
    }
    return { owner: defaultRepo.owner, repo: defaultRepo.repo, number: Number(bare[1]) };
  }

  throw new GithubError(
    "invalid",
    `\`${text}\` 은 이슈 참조로 읽을 수 없습니다`,
    "/issue https://github.com/owner/repo/issues/1 또는 /issue owner/repo#1 또는 /issue 1",
  );
}

export function issueBranchName(number: number): string {
  return `cbot/issue-${number}`;
}

export function formatIssueContext(issue: GithubIssue): string {
  const labels = issue.labels.length > 0 ? issue.labels.map((l) => `\`${l}\``).join(", ") : "(없음)";
  const body = issue.body.trim().length > 0 ? issue.body.trim() : "(본문 없음)";
  return [
    `GitHub 이슈 #${issue.number}: ${issue.title}`,
    `URL: ${issue.htmlUrl}`,
    `상태: ${issue.state}`,
    `라벨: ${labels}`,
    "",
    body,
    "",
    "이 이슈를 구현하라. 끝나면 github_create_pr 도구로 드래프트 PR을 만든다.",
  ].join("\n");
}

export function formatIssueNotice(issue: GithubIssue, branch: string): string {
  const labels = issue.labels.length > 0 ? issue.labels.join(", ") : "(없음)";
  return [
    `이슈 #${issue.number} — ${issue.title}`,
    `- URL: ${issue.htmlUrl}`,
    `- 브랜치: \`${branch}\``,
    `- 라벨: ${labels}`,
    "",
    issue.body.trim() || "(본문 없음)",
  ].join("\n");
}

export async function loadGithubToken(
  home: string,
  processEnv: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  const fromEnv = processEnv[GITHUB_TOKEN_ENV]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const file = await readEnvFile(secretsPath(home));
  const fromFile = file[GITHUB_TOKEN_ENV]?.trim();
  return fromFile || undefined;
}

export async function saveGithubToken(home: string, token: string): Promise<void> {
  const path = secretsPath(home);
  const current = await readEnvFile(path);
  if (token.trim()) {
    current[GITHUB_TOKEN_ENV] = token.trim();
  } else {
    delete current[GITHUB_TOKEN_ENV];
  }
  const body = Object.entries(current)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")
    .concat("\n");
  await Bun.write(path, body);
  await chmod(path, 0o600);
}

export async function fetchGithubIssue(
  ref: GithubIssueRef,
  opts: { token?: string; fetch?: FetchLike } = {},
): Promise<GithubIssue> {
  const doFetch = opts.fetch ?? (globalThis.fetch as FetchLike);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "c-bot",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await doFetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`, {
      headers,
    });
  } catch (err) {
    throw new GithubError(
      "network",
      `GitHub에 연결하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
      "네트워크를 확인한 뒤 다시 시도하세요.",
    );
  }
  if (res.status === 401) {
    throw new GithubError(
      "auth",
      "GitHub 인증에 실패했습니다",
      `$CBOT_HOME/.env 에 ${GITHUB_TOKEN_ENV}=… 를 넣은 뒤 다시 시도하세요.`,
    );
  }
  if (res.status === 403) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    if (/rate limit/i.test(detail)) {
      throw new GithubError(
        "network",
        "GitHub API rate limit에 걸렸습니다",
        `잠시 기다리거나 ${GITHUB_TOKEN_ENV} 을 넣어 인증 요청으로 한도를 올리세요.`,
      );
    }
    throw new GithubError(
      "permission",
      "이 이슈를 읽을 권한이 없습니다",
      `권한이 있는 ${GITHUB_TOKEN_ENV} 을 설정하거나 공개 이슈 URL인지 확인하세요.`,
    );
  }
  if (res.status === 404) {
    throw new GithubError(
      "not_found",
      `이슈 #${ref.number} 을 찾지 못했습니다`,
      "owner/repo 와 번호를 확인한 뒤 다시 시도하세요.",
    );
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new GithubError(
      "network",
      `GitHub API 오류 (HTTP ${res.status})${detail ? `: ${detail}` : ""}`,
      "잠시 후 다시 시도하세요.",
    );
  }
  const data = (await res.json()) as {
    number?: number;
    title?: string;
    body?: string | null;
    html_url?: string;
    state?: string;
    labels?: { name?: string }[] | string[];
    pull_request?: unknown;
  };
  if (data.pull_request) {
    throw new GithubError(
      "invalid",
      `#${ref.number} 은 이슈가 아니라 Pull Request입니다`,
      "이슈 번호로 다시 시도하세요.",
    );
  }
  return {
    number: data.number ?? ref.number,
    title: data.title?.trim() || `Issue #${ref.number}`,
    body: typeof data.body === "string" ? data.body : "",
    labels: (data.labels ?? []).map((label) => (typeof label === "string" ? label : label.name ?? "")).filter(Boolean),
    htmlUrl: data.html_url ?? `https://github.com/${ref.owner}/${ref.repo}/issues/${ref.number}`,
    owner: ref.owner,
    repo: ref.repo,
    state: data.state ?? "open",
  };
}

/** owner/repo from a git remote URL, or null when it is not GitHub. */
export function parseGithubRemote(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim();
  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(trimmed);
  if (ssh) {
    return { owner: ssh[1]!, repo: stripGit(ssh[2]!) };
  }
  const https = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/i.exec(trimmed);
  if (https) {
    return { owner: https[1]!, repo: stripGit(https[2]!) };
  }
  return null;
}

export async function resolveGithubRepo(
  cwd: string,
): Promise<{ owner: string; repo: string } | null> {
  const remote = await runGit(cwd, ["remote", "get-url", "origin"]);
  if (!remote.ok) {
    return null;
  }
  return parseGithubRemote(remote.out.trim());
}

export async function defaultBaseBranch(cwd: string): Promise<string> {
  const symbolic = await runGit(cwd, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  if (symbolic.ok) {
    const name = symbolic.out.trim().replace(/^refs\/remotes\/origin\//, "");
    if (name.length > 0) {
      return name;
    }
  }
  for (const candidate of ["main", "master"]) {
    const has = await runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`]);
    if (has.ok) {
      return candidate;
    }
    const local = await runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]);
    if (local.ok) {
      return candidate;
    }
  }
  const branch = await runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return branch.ok && branch.out.trim() ? branch.out.trim() : "main";
}

export async function currentBranch(cwd: string): Promise<string | null> {
  const branch = await runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return branch.ok ? branch.out.trim() || null : null;
}

/** Env that injects Authorization via git config (never put the token on argv). */
export function gitPushAuthEnv(token: string): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
  };
}

/** argv for `git push` — no secrets. */
export function pushGitArgs(branch: string): string[] {
  return ["push", "-u", "origin", `HEAD:refs/heads/${branch}`];
}

export async function pushBranch(cwd: string, branch: string, token?: string): Promise<void> {
  // Bearer via GIT_CONFIG_* so the token never appears in process argv (ps).
  const pushed = await runGit(cwd, pushGitArgs(branch), token ? gitPushAuthEnv(token) : undefined);
  if (!pushed.ok) {
    const err = pushed.err.trim();
    if (/Authentication failed|could not read Username|Invalid username|403|401/i.test(err)) {
      throw new GithubError(
        "auth",
        "브랜치를 push하지 못했습니다 (인증)",
        `$CBOT_HOME/.env 에 권한이 있는 ${GITHUB_TOKEN_ENV} 을 넣고, git credential 또는 HTTPS remote를 확인한 뒤 다시 시도하세요.`,
      );
    }
    if (/rejected|non-fast-forward|already exists/i.test(err)) {
      throw new GithubError(
        "conflict",
        "브랜치 push가 거부되었습니다",
        "원격 브랜치와 충돌합니다. 로컬을 맞춘 뒤 다시 시도하세요.",
      );
    }
    throw new GithubError(
      "network",
      `git push 실패: ${firstLine(err) || "알 수 없는 오류"}`,
      "remote 설정을 확인한 뒤 다시 시도하세요.",
    );
  }
}

export async function createDraftPullRequest(
  input: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
    token: string;
  },
  opts: { fetch?: FetchLike } = {},
): Promise<{ htmlUrl: string; number: number }> {
  const doFetch = opts.fetch ?? (globalThis.fetch as FetchLike);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${input.token}`,
    "User-Agent": "c-bot",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await doFetch(`https://api.github.com/repos/${input.owner}/${input.repo}/pulls`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
        draft: true,
      }),
    });
  } catch (err) {
    throw new GithubError(
      "network",
      `GitHub에 연결하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
      "네트워크를 확인한 뒤 다시 시도하세요.",
    );
  }
  if (res.status === 401) {
    throw new GithubError(
      "auth",
      "GitHub 인증에 실패했습니다",
      `$CBOT_HOME/.env 에 유효한 ${GITHUB_TOKEN_ENV} 을 넣은 뒤 다시 시도하세요.`,
    );
  }
  if (res.status === 403) {
    throw new GithubError(
      "permission",
      "드래프트 PR을 만들 권한이 없습니다",
      `repo 권한이 있는 ${GITHUB_TOKEN_ENV} 으로 다시 시도하세요.`,
    );
  }
  if (res.status === 422) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new GithubError(
      "conflict",
      `PR을 만들지 못했습니다${detail ? `: ${detail}` : ""}`,
      "같은 브랜치의 PR이 이미 있거나 base/head 가 잘못되었을 수 있습니다. 확인 후 다시 시도하세요.",
    );
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new GithubError(
      "network",
      `GitHub API 오류 (HTTP ${res.status})${detail ? `: ${detail}` : ""}`,
      "잠시 후 다시 시도하세요.",
    );
  }
  const data = (await res.json()) as { html_url?: string; number?: number };
  if (!data.html_url || !data.number) {
    throw new GithubError("network", "PR 응답에 URL이 없습니다", "잠시 후 다시 시도하세요.");
  }
  return { htmlUrl: data.html_url, number: data.number };
}

function stripGit(name: string): string {
  return name.replace(/\.git$/i, "");
}

function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "";
}

async function readEnvFile(path: string): Promise<Record<string, string>> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return {};
  }
  const out: Record<string, string> = {};
  const text = await file.text();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function runGit(
  cwd: string,
  args: string[],
  envOverrides?: Record<string, string>,
): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const proc = Bun.spawn(["git", "-c", "core.quotePath=false", ...args], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...envOverrides },
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: code === 0, out, err };
  } catch (error) {
    return { ok: false, out: "", err: error instanceof Error ? error.message : String(error) };
  }
}
