import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { asSessionId } from "@cbot/shared";
import {
  GithubWebhookStore,
  normalizePrUrl,
} from "../src/github-webhook-store.ts";
import {
  formatCiFailureReworkContext,
  formatReviewReworkContext,
  loadGithubWebhookSecret,
  saveGithubWebhookSecret,
  verifyGithubWebhookSignature,
} from "../src/github.ts";

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("verifyGithubWebhookSignature", () => {
  test("accepts a valid HMAC and rejects bad or missing signatures", () => {
    const secret = "s3cr3t";
    const body = '{"ok":true}';
    expect(verifyGithubWebhookSignature(secret, body, sign(secret, body))).toBe(true);
    expect(verifyGithubWebhookSignature(secret, body, sign("other", body))).toBe(false);
    expect(verifyGithubWebhookSignature(secret, body, null)).toBe(false);
    expect(verifyGithubWebhookSignature("", body, sign(secret, body))).toBe(false);
  });
});

describe("github webhook secret under CBOT_HOME", () => {
  test("saves and loads GITHUB_WEBHOOK_SECRET", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-wh-secret-"));
    expect(await loadGithubWebhookSecret(home, {})).toBeUndefined();
    await saveGithubWebhookSecret(home, "whsec_test");
    expect(await loadGithubWebhookSecret(home, {})).toBe("whsec_test");
  });
});

describe("GithubWebhookStore", () => {
  test("claims each delivery id at most once", async () => {
    const store = await GithubWebhookStore.open(":memory:");
    expect(store.claimDelivery("d1")).toBe(true);
    expect(store.claimDelivery("d1")).toBe(false);
    expect(store.hasDelivery("d1")).toBe(true);
    store.close();
  });

  test("remembers PR URL → session", async () => {
    const store = await GithubWebhookStore.open(":memory:");
    const id = asSessionId("ses_abc");
    store.rememberPrSession("https://github.com/Acme/App/pull/3/", id, "cbot/issue-1");
    expect(store.sessionIdForPr("https://github.com/acme/app/pull/3")).toBe(id);
    store.close();
  });
});

describe("normalizePrUrl", () => {
  test("folds case and trailing slash", () => {
    expect(normalizePrUrl("https://GitHub.com/Acme/App/pull/9/")).toBe(
      "https://github.com/acme/app/pull/9",
    );
  });
});

describe("rework context formatters", () => {
  test("include file/line and CI summary", () => {
    const review = formatReviewReworkContext({
      prUrl: "https://github.com/a/b/pull/1",
      body: "please fix",
      path: "src/a.ts",
      line: 12,
    });
    expect(review).toContain("src/a.ts");
    expect(review).toContain("L12");
    expect(review).toContain("please fix");
    expect(review).toContain("github_create_pr");

    const ci = formatCiFailureReworkContext({
      branch: "cbot/issue-2",
      name: "CI",
      conclusion: "failure",
      summary: "tests failed",
    });
    expect(ci).toContain("cbot/issue-2");
    expect(ci).toContain("failure");
    expect(ci).toContain("tests failed");
  });
});
