/**
 * `/issue` — fetch a GitHub issue and attach (or open) a worktree session on
 * `cbot/issue-<n>` with the issue body in session context.
 */
import {
  WorktreeError,
  addWorktree,
  fetchGithubIssue,
  formatIssueContext,
  formatIssueNotice,
  GithubError,
  issueBranchName,
  loadGithubToken,
  parseIssueRef,
  resolveGithubRepo,
  type GithubIssue,
} from "@cbot/agent";
import {
  SESSION_TITLE_MAX,
  normalizeSessionTitle,
  sessionProject,
  type SessionId,
  type SessionSummary,
  type SessionWorktree,
} from "@cbot/shared";
import type { Runtime } from "./runtime.ts";

export async function runIssueCommand(
  runtime: Runtime,
  sessionId: SessionId,
  session: SessionSummary,
  args: string,
): Promise<void> {
  if (args.trim().length === 0) {
    notice(
      runtime,
      sessionId,
      "이슈 번호나 URL이 필요합니다.\n`/issue <url|번호>` — 예: `/issue 12`, `/issue owner/repo#12`, `/issue https://github.com/owner/repo/issues/12`",
    );
    return;
  }

  const project = sessionProject(session);
  if (!project) {
    notice(runtime, sessionId, "프로젝트를 먼저 여세요.");
    return;
  }

  const repo = await resolveGithubRepo(project);
  let ref;
  try {
    ref = parseIssueRef(args, repo);
  } catch (err) {
    notice(runtime, sessionId, formatErr(err));
    return;
  }

  const token = await loadGithubToken(runtime.env.home);
  let issue: GithubIssue;
  try {
    issue = await fetchGithubIssue(ref, { ...(token ? { token } : {}) });
  } catch (err) {
    notice(runtime, sessionId, formatErr(err));
    return;
  }

  const branch = issueBranchName(issue.number);
  const title = clipTitle(`#${issue.number} ${issue.title}`);

  try {
    const target = await ensureIssueSession(runtime, sessionId, session, project, branch, title);
    seedIssueContext(runtime, target.id, issue, branch);
    if (target.id === sessionId) {
      notice(
        runtime,
        sessionId,
        [
          target.created
            ? `이슈 워크트리를 이 세션에 붙였습니다 (\`${branch}\`).`
            : target.reused
              ? `이미 \`${branch}\` 워크트리 세션입니다. 이슈 내용을 다시 넣었습니다.`
              : `이슈 컨텍스트를 갱신했습니다.`,
          "",
          formatIssueNotice(issue, branch),
        ].join("\n"),
      );
    } else {
      notice(
        runtime,
        sessionId,
        [
          target.created
            ? `이슈 #${issue.number} 용 세션을 만들었습니다.`
            : `이슈 #${issue.number} 용 세션이 이미 있어 그걸 씁니다.`,
          `- 세션: ${target.title} (\`${target.id}\`)`,
          `- 브랜치: \`${branch}\``,
          "",
          "사이드바에서 해당 세션을 여세요.",
          "",
          formatIssueNotice(issue, branch),
        ].join("\n"),
      );
      notice(
        runtime,
        target.id,
        [
          `이슈 #${issue.number} 세션이 준비되었습니다 (\`${branch}\`).`,
          "",
          formatIssueNotice(issue, branch),
        ].join("\n"),
      );
    }
  } catch (err) {
    notice(runtime, sessionId, formatErr(err));
  }
}

async function ensureIssueSession(
  runtime: Runtime,
  sessionId: SessionId,
  session: SessionSummary,
  project: string,
  branch: string,
  title: string,
): Promise<{ id: SessionId; title: string; created: boolean; reused: boolean }> {
  if (session.worktree?.branch === branch && session.worktree.project === project) {
    if (session.title !== title) {
      runtime.store.setTitle(sessionId, title);
    }
    return { id: sessionId, title, created: false, reused: true };
  }

  const existing = runtime.store
    .list({ kind: "coding", project })
    .find((item) => item.worktree?.branch === branch && item.worktree.project === project);
  if (existing) {
    return { id: existing.id, title: existing.title, created: false, reused: true };
  }

  // Current session is a different worktree — open a sibling session.
  if (session.worktree) {
    const added = await addWorktreeSafe(runtime, project, branch);
    const created = runtime.store.create({
      title,
      workspace: added.workspace,
      worktree: added.worktree,
    });
    return { id: created.id, title: created.title, created: true, reused: false };
  }

  // Plain coding session: attach the new worktree in place.
  const added = await addWorktreeSafe(runtime, project, branch);
  runtime.store.setWorktree(sessionId, added.workspace, added.worktree);
  runtime.store.setTitle(sessionId, title);
  return { id: sessionId, title, created: true, reused: false };
}

async function addWorktreeSafe(
  runtime: Runtime,
  project: string,
  branch: string,
): Promise<{ workspace: string; worktree: SessionWorktree }> {
  try {
    return await addWorktree({ home: runtime.env.home, project, branch });
  } catch (err) {
    if (err instanceof WorktreeError) {
      if (err.code === "not_repo") {
        throw new GithubError(
          "non_git",
          "git 저장소가 아닙니다",
          "프로젝트를 git 저장소로 연 뒤 다시 시도하세요.",
        );
      }
      if (err.code === "no_commits") {
        throw new GithubError(
          "non_git",
          "커밋이 없어 워크트리를 만들 수 없습니다",
          "첫 커밋 후 다시 시도하세요.",
        );
      }
      if (err.code === "branch_exists") {
        throw new GithubError(
          "conflict",
          `브랜치 \`${branch}\` 가 이미 있습니다`,
          "기존 브랜치를 지우거나 다른 이슈 번호로 다시 시도하세요. 이미 이 브랜치 세션이 있으면 `/issue` 가 그걸 재사용합니다.",
        );
      }
      throw new GithubError("conflict", err.message, "상태를 확인한 뒤 다시 시도하세요.");
    }
    throw err;
  }
}

function seedIssueContext(
  runtime: Runtime,
  sessionId: SessionId,
  issue: GithubIssue,
  branch: string,
): void {
  // Model-visible briefing without starting a turn (no wake).
  runtime.store.append(sessionId, {
    type: "user/message",
    text: formatIssueContext(issue),
    mentions: [],
  });
  void branch;
}

function notice(runtime: Runtime, sessionId: SessionId, text: string): void {
  runtime.store.append(sessionId, { type: "system/notice", command: "issue", text });
}

function formatErr(err: unknown): string {
  if (err instanceof GithubError) {
    const lines = [`[reason: ${err.code}] ${err.message}`];
    if (err.hint) {
      lines.push(`다시 시도: ${err.hint}`);
    }
    return lines.join("\n");
  }
  if (err instanceof WorktreeError) {
    return `[reason: ${err.code}] ${err.message}\n다시 시도: 브랜치·저장소 상태를 확인한 뒤 다시 호출하세요.`;
  }
  return `[reason: unknown] ${err instanceof Error ? err.message : String(err)}`;
}

function clipTitle(text: string): string {
  const normalized = normalizeSessionTitle(text);
  if (normalized.length <= SESSION_TITLE_MAX) {
    return normalized;
  }
  return `${normalized.slice(0, SESSION_TITLE_MAX - 1)}…`;
}
