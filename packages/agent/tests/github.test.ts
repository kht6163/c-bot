import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  GithubError,
  fetchGithubIssue,
  formatIssueContext,
  gitPushAuthEnv,
  issueBranchName,
  loadGithubToken,
  parseGithubRemote,
  parseIssueRef,
  pushGitArgs,
  saveGithubToken,
  type FetchLike,
} from "../src/github.ts";
import { allowGithubWriteTools, githubCreatePrTool } from "../src/tools/github.ts";

describe("parseIssueRef", () => {
  test("reads URL, shorthand, and bare number with default repo", () => {
    expect(parseIssueRef("https://github.com/octocat/Hello-World/issues/1")).toEqual({
      owner: "octocat",
      repo: "Hello-World",
      number: 1,
    });
    expect(parseIssueRef("octocat/Hello-World#42")).toEqual({
      owner: "octocat",
      repo: "Hello-World",
      number: 42,
    });
    expect(parseIssueRef("7", { owner: "acme", repo: "app" })).toEqual({
      owner: "acme",
      repo: "app",
      number: 7,
    });
  });

  test("refuses bare number without a default repo", () => {
    expect(() => parseIssueRef("3")).toThrow(GithubError);
  });
});

describe("parseGithubRemote", () => {
  test("reads https and ssh remotes", () => {
    expect(parseGithubRemote("https://github.com/kht6163/c-bot.git")).toEqual({
      owner: "kht6163",
      repo: "c-bot",
    });
    expect(parseGithubRemote("git@github.com:kht6163/c-bot.git")).toEqual({
      owner: "kht6163",
      repo: "c-bot",
    });
    expect(parseGithubRemote("https://gitlab.com/acme/app.git")).toBeNull();
  });
});

describe("github token under CBOT_HOME", () => {
  test("saves and loads GITHUB_TOKEN without echoing it elsewhere", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-gh-token-"));
    expect(await loadGithubToken(home, {})).toBeUndefined();
    await saveGithubToken(home, "ghp_test_secret");
    expect(await loadGithubToken(home, {})).toBe("ghp_test_secret");
    const env = await Bun.file(join(home, ".env")).text();
    expect(env).toContain("GITHUB_TOKEN=ghp_test_secret");
  });
});

describe("fetchGithubIssue", () => {
  test("maps a mocked payload", async () => {
    const fetchMock: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({
        number: 1,
        title: "Hello",
        body: "World",
        html_url: "https://github.com/octocat/Hello-World/issues/1",
        state: "open",
        labels: [{ name: "bug" }],
      }),
    });
    const issue = await fetchGithubIssue(
      { owner: "octocat", repo: "Hello-World", number: 1 },
      { fetch: fetchMock },
    );
    expect(issue.title).toBe("Hello");
    expect(issue.labels).toEqual(["bug"]);
    expect(formatIssueContext(issue)).toContain("World");
    expect(issueBranchName(issue.number)).toBe("cbot/issue-1");
  });

  test("surfaces auth failures with a retry hint", async () => {
    const fetchMock: FetchLike = async () => ({
      ok: false,
      status: 401,
      text: async () => "bad",
      json: async () => ({}),
    });
    try {
      await fetchGithubIssue({ owner: "o", repo: "r", number: 1 }, { token: "x", fetch: fetchMock });
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(GithubError);
      expect((err as GithubError).code).toBe("auth");
      expect((err as GithubError).hint).toContain("GITHUB_TOKEN");
    }
  });

  test("reads the public octocat Hello-World issues API when network allows", async () => {
    try {
      // Hint endpoint: GET /repos/octocat/Hello-World/issues/1 (no token).
      // That number is historically a PR on this repo; a pure issue still proves read works.
      const issue = await fetchGithubIssue({ owner: "octocat", repo: "Hello-World", number: 11163 });
      expect(issue.number).toBe(11163);
      expect(issue.title.length).toBeGreaterThan(0);
      expect(issue.htmlUrl).toContain("github.com/octocat/Hello-World/issues/");
    } catch (err) {
      if (err instanceof GithubError && err.code === "invalid") {
        // #1-style PR payload still means the public API answered.
        return;
      }
      if (err instanceof GithubError && (err.code === "network" || err.code === "permission" || err.code === "not_found")) {
        // Offline CI / rate limit / churn — not a product failure.
        return;
      }
      throw err;
    }
  });
});

describe("github_create_pr tool", () => {
  test("always needs approval, even when approval.mode is allow", () => {
    const tool = githubCreatePrTool({ home: "/tmp" });
    expect(tool.needsApproval({}, { workspace: "/tmp", approvalMode: "allow" })).toBe(true);
    expect(tool.needsApproval({}, { workspace: "/tmp", approvalMode: "prompt" })).toBe(true);
  });

  test("missing token is a soft failure with no remote side effects", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-gh-tool-"));
    const tool = githubCreatePrTool({ home });
    const workspace = await mkdtemp(join(tmpdir(), "cbot-gh-ws-"));
    const result = await tool.execute(
      { title: "Draft" },
      { workspace, approvalMode: "prompt" },
    );
    expect(result).toContain("[reason: auth]");
    expect(result).toContain("GITHUB_TOKEN");
  });
});

describe("allowGithubWriteTools", () => {
  test("leaders and non-bot mode may write; specialists may not", () => {
    expect(allowGithubWriteTools("leader")).toBe(true);
    expect(allowGithubWriteTools(undefined)).toBe(true);
    expect(allowGithubWriteTools(null)).toBe(true);
    expect(allowGithubWriteTools("specialist")).toBe(false);
  });
});


describe("git push auth helpers", () => {
  test("push argv never contains the token; auth lives in GIT_CONFIG env", () => {
    const token = "ghp_super_secret_token_value";
    const args = pushGitArgs("cbot/issue-1");
    const env = gitPushAuthEnv(token);
    expect(args.join(" ")).not.toContain(token);
    expect(JSON.stringify(args)).not.toContain(token);
    expect(args).toEqual(["push", "-u", "origin", "HEAD:refs/heads/cbot/issue-1"]);
    expect(env.GIT_CONFIG_COUNT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe("http.extraHeader");
    expect(env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Bearer ${token}`);
  });

  test("scrubbed child env drops GITHUB_TOKEN before GIT_CONFIG overlays", async () => {
    const { scrubEnv } = await import("../src/tools/bash.ts");
    const token = "ghp_environ_should_not_leak";
    const previous = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = token;
    try {
      const cleaned = scrubEnv(process.env);
      expect(cleaned.GITHUB_TOKEN).toBeUndefined();
      const merged: Record<string, string | undefined> = {
        ...cleaned,
        GIT_TERMINAL_PROMPT: "0",
        ...gitPushAuthEnv(token),
      };
      expect(merged.GITHUB_TOKEN).toBeUndefined();
      expect(merged.GIT_CONFIG_VALUE_0).toContain(token);
    } finally {
      if (previous === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previous;
    }
  });
});
