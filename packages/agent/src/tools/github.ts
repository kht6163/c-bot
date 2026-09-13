import {
  createDraftPullRequest,
  currentBranch,
  defaultBaseBranch,
  GithubError,
  loadGithubToken,
  pushBranch,
  resolveGithubRepo,
} from "../github.ts";
import { asOptionalString, asString, type ToolDefinition } from "./types.ts";

/** Specialists never receive GitHub write tools; leaders (and non-bot mode) do. */
export function allowGithubWriteTools(role: "leader" | "specialist" | null | undefined): boolean {
  return role == null || role === "leader";
}

/**
 * Leader-only write tool: push the session branch and open a draft PR.
 * Always asks for approval; reject / missing token leave the remote untouched.
 */
export function githubCreatePrTool(opts: { home: string }): ToolDefinition {
  return {
    name: "github_create_pr",
    ui: "generic",
    description:
      "Push the current branch to origin and open a GitHub draft pull request. Always requires user approval. Use after committing work for an issue. Pass title and optional body/base.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "PR title" },
        body: { type: "string", description: "PR body (markdown)" },
        base: { type: "string", description: "Base branch (default: repo default)" },
      },
      required: ["title"],
    },
    needsApproval: () => true,
    approvalRule: () => "github_create_pr",
    async execute(args, ctx) {
      const title = asString(args, "title");
      const body = asOptionalString(args, "body") ?? "";
      const baseArg = asOptionalString(args, "base");

      if (!ctx.workspace) {
        return fail("non_git", "워크스페이스가 없어 PR을 만들 수 없습니다", "프로젝트를 연 뒤 다시 시도하세요.");
      }

      const token = await loadGithubToken(opts.home);
      if (!token) {
        return fail(
          "auth",
          "GitHub 토큰이 없습니다",
          `$CBOT_HOME/.env 에 GITHUB_TOKEN=… 을 넣은 뒤 승인 카드에서 다시 실행하세요.`,
        );
      }

      const repo = await resolveGithubRepo(ctx.workspace);
      if (!repo) {
        return fail(
          "non_git",
          "origin remote가 GitHub 저장소가 아닙니다",
          "git remote 가 github.com 을 가리키는지 확인한 뒤 다시 시도하세요.",
        );
      }

      const head = await currentBranch(ctx.workspace);
      if (!head) {
        return fail(
          "conflict",
          "DETACHED HEAD 에서는 PR을 만들 수 없습니다",
          "브랜치를 체크아웃한 뒤 다시 시도하세요.",
        );
      }

      const base = baseArg?.trim() || (await defaultBaseBranch(ctx.workspace));
      if (base === head) {
        return fail(
          "conflict",
          `base 와 head 가 같습니다 (\`${head}\`)`,
          "이슈 브랜치에서 커밋한 뒤 다시 시도하세요.",
        );
      }

      try {
        await pushBranch(ctx.workspace, head, token);
        const pr = await createDraftPullRequest({
          owner: repo.owner,
          repo: repo.repo,
          title,
          body,
          head,
          base,
          token,
        });
        return `드래프트 PR #${pr.number}: ${pr.htmlUrl}`;
      } catch (err) {
        if (err instanceof GithubError) {
          return fail(err.code, err.message, err.hint);
        }
        return fail(
          "network",
          err instanceof Error ? err.message : String(err),
          "잠시 후 다시 시도하세요.",
        );
      }
    },
  };
}

function fail(code: string, message: string, hint?: string): string {
  const lines = [`[reason: ${code}] ${message}`];
  if (hint) {
    lines.push(`다시 시도: ${hint}`);
  }
  return lines.join("\n");
}
