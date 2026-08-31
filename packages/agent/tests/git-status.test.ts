import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gitCommit,
  gitStatus,
  gitView,
  isCommitSha,
  parseGitLog,
  parseGitNumstat,
  parseGitRefs,
  parseGitShow,
  parseGitStatus,
} from "../src/git-status.ts";

describe("parseGitStatus", () => {
  test("reads branch, ahead, and porcelain files", () => {
    const parsed = parseGitStatus(
      [
        "## main...origin/main [ahead 4]",
        " M apps/web/src/App.tsx",
        "?? notes.md",
        "A  added.txt",
      ].join("\n"),
    );
    expect(parsed.branch).toBe("main");
    expect(parsed.upstream).toBe("origin/main");
    expect(parsed.ahead).toBe(4);
    expect(parsed.behind).toBe(0);
    expect(parsed.files.map((item) => item.label)).toEqual(["수정", "추적 안 함", "추가"]);
    expect(parsed.files[0]?.path).toBe("apps/web/src/App.tsx");
  });
});

describe("gitStatus", () => {
  test("keeps a non-ASCII path readable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cbot-git-"));
    await Bun.spawn(["git", "init", "-q", "."], { cwd: dir }).exited;
    await writeFile(join(dir, "한글파일.md"), "hi");
    const status = await gitStatus(dir);
    expect(status.repo).toBe(true);
    expect(status.files.map((file) => file.path)).toContain("한글파일.md");
  });
});

describe("parseGitRefs", () => {
  test("splits locals, remotes, and tags and marks HEAD", () => {
    const refs = parseGitRefs(
      [
        "refs/heads/main\tmain\te9f786b\torigin/main\t*",
        "refs/heads/work\twork\t4ef2f7c\t\t",
        "refs/remotes/origin/HEAD\torigin/HEAD\te9f786b\t\t",
        "refs/remotes/origin/main\torigin/main\t6f093f9\t\t",
        "refs/tags/v1\tv1\t7417f54\t\t",
      ].join("\n"),
    );
    expect(refs.map((ref) => [ref.name, ref.kind])).toEqual([
      ["main", "local"],
      ["work", "local"],
      ["origin/main", "remote"],
      ["v1", "tag"],
    ]);
    expect(refs[0]?.head).toBe(true);
    expect(refs[0]?.upstream).toBe("origin/main");
    expect(refs[1]?.head).toBe(false);
    expect(refs[1]?.upstream).toBe(null);
  });
});

describe("parseGitLog", () => {
  test("reads the decoration as ref names and keeps a tabbed subject whole", () => {
    const commits = parseGitLog(
      [
        "e9f786bfull\te9f786b\thantaekim\t2026-08-28T16:36:00+09:00\tHEAD -> main, origin/main, tag: v1\tfix(bot):\t조각",
        "4ef2f7cfull\t4ef2f7c\thantaekim\t2026-08-28T16:18:00+09:00\t\tfeat(bot): 지우기",
      ].join("\n"),
    );
    expect(commits[0]?.refs).toEqual(["main", "origin/main", "v1"]);
    expect(commits[0]?.subject).toBe("fix(bot):\t조각");
    expect(commits[1]?.refs).toEqual([]);
    expect(commits[1]?.short).toBe("4ef2f7c");
  });
});

describe("gitView", () => {
  test("a repo without commits still reports its status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cbot-git-"));
    await Bun.spawn(["git", "init", "-q", "."], { cwd: dir }).exited;
    await writeFile(join(dir, "note.md"), "hi");
    const view = await gitView(dir);
    expect(view.repo).toBe(true);
    expect(view.commits).toEqual([]);
    expect(view.files.map((file) => file.path)).toContain("note.md");
  });

  test("lists the local branch and its commit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cbot-git-"));
    await Bun.spawn(["git", "init", "-q", "-b", "main", "."], { cwd: dir }).exited;
    await writeFile(join(dir, "note.md"), "hi");
    await Bun.spawn(["git", "add", "."], { cwd: dir }).exited;
    await Bun.spawn(
      ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "첫 커밋"],
      { cwd: dir },
    ).exited;
    const view = await gitView(dir);
    expect(view.refs.map((ref) => ref.name)).toEqual(["main"]);
    expect(view.refs[0]?.head).toBe(true);
    expect(view.commits[0]?.subject).toBe("첫 커밋");
    expect(view.commits[0]?.refs).toContain("main");
  });
});

describe("parseGitShow", () => {
  test("keeps a multi-line body whole", () => {
    const detail = parseGitShow(
      [
        "e9f786bfull",
        "e9f786b",
        "hantaekim",
        "kht@example.com",
        "2026-08-28T16:36:00+09:00",
        "HEAD -> main",
        "fix(bot): 조각",
        "왜 이렇게 했는지\n\n두 번째 줄\n",
      ].join("\x1f"),
    );
    expect(detail?.email).toBe("kht@example.com");
    expect(detail?.refs).toEqual(["main"]);
    expect(detail?.body).toBe("왜 이렇게 했는지\n\n두 번째 줄");
  });

  test("an empty answer is no commit", () => {
    expect(parseGitShow("")).toBeUndefined();
  });
});

describe("parseGitNumstat", () => {
  test("reads counts and marks a binary file", () => {
    const files = parseGitNumstat(["4\t2\tapps/web/src/App.tsx", "-\t-\tdocs/logo.png"].join("\n"));
    expect(files[0]).toEqual({ path: "apps/web/src/App.tsx", added: 4, removed: 2 });
    expect(files[1]).toEqual({ path: "docs/logo.png", added: null, removed: null });
  });
});

describe("isCommitSha", () => {
  test("only a hex object name passes", () => {
    expect(isCommitSha("e9f786b")).toBe(true);
    expect(isCommitSha("main")).toBe(false);
    expect(isCommitSha("HEAD~1")).toBe(false);
    expect(isCommitSha("--all")).toBe(false);
    expect(isCommitSha("a..b")).toBe(false);
  });
});

describe("gitCommit", () => {
  test("reads the message body and the files a commit touched", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cbot-git-"));
    await Bun.spawn(["git", "init", "-q", "-b", "main", "."], { cwd: dir }).exited;
    await writeFile(join(dir, "note.md"), "한 줄\n두 줄\n");
    await Bun.spawn(["git", "add", "."], { cwd: dir }).exited;
    await Bun.spawn(
      [
        "git",
        "-c",
        "user.email=t@t",
        "-c",
        "user.name=t",
        "commit",
        "-q",
        "-m",
        "첫 커밋",
        "-m",
        "본문 줄",
      ],
      { cwd: dir },
    ).exited;
    const view = await gitView(dir);
    const sha = view.commits[0]?.sha ?? "";
    const detail = await gitCommit(dir, sha);
    expect(detail?.subject).toBe("첫 커밋");
    expect(detail?.body).toBe("본문 줄");
    expect(detail?.email).toBe("t@t");
    expect(detail?.files).toEqual([{ path: "note.md", added: 2, removed: 0 }]);
  });

  test("an unknown revision is no commit, not an error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cbot-git-"));
    await Bun.spawn(["git", "init", "-q", "."], { cwd: dir }).exited;
    expect(await gitCommit(dir, "0123456")).toBeUndefined();
    expect(await gitCommit(dir, "HEAD")).toBeUndefined();
  });
});
