import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { GitDiffScope, GitDiffView } from "@cbot/shared";
import { gitStatus } from "./git-status.ts";

const PATCH_LIMIT = 256 * 1024;

export class GitDiffError extends Error {}

/** Git receives literal pathspecs and never runs configured diff programs. */
export async function gitDiff(workspace: string, path: string, scope: GitDiffScope): Promise<GitDiffView> {
  const root = await realpath(workspace);
  const target = resolve(root, path);
  if (!path || path.includes("\0") || isAbsolute(path) || !inside(root, target) || target === root) {
    throw new GitDiffError("워크스페이스 안의 파일 경로를 선택해 주세요");
  }
  // Check ancestors even for deleted paths, without dereferencing a final symlink.
  let parent = dirname(target);
  for (;;) {
    const actual = await realpath(parent).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (actual) {
      if (!inside(root, actual)) throw new GitDiffError("워크스페이스 밖의 파일은 비교할 수 없습니다");
      break;
    }
    parent = dirname(parent);
  }
  const normalized = relative(root, target);
  const status = await gitStatus(root);
  const file = status.files.find((entry) => entry.path === normalized);
  if (!file || (scope === "untracked" ? file.index !== "?" : scope === "staged" ? [" ", "?"].includes(file.index) : [" ", "?"].includes(file.worktree))) {
    throw new GitDiffError("선택한 범위의 변경이 없습니다. 새로고침해 주세요");
  }
  const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (info && !info.isFile() && !info.isSymbolicLink()) {
    throw new GitDiffError("일반 파일과 심볼릭 링크의 변경만 표시할 수 있습니다");
  }
  const options = ["--no-ext-diff", "--no-textconv", "--no-color", "--find-renames", "--src-prefix=a/", "--dst-prefix=b/"];
  const args = scope === "untracked"
    ? ["diff", ...options, "--no-index", "--", "/dev/null", normalized]
    : ["diff", ...options, ...(scope === "staged" ? ["--cached"] : []), "--", normalized,
      ...(scope === "staged" && file.originalPath ? [file.originalPath] : [])];
  const proc = Bun.spawn(["git", "--literal-pathspecs", "-c", "core.quotePath=false", ...args], {
    cwd: root, stdout: "pipe", stderr: "ignore",
  });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; proc.kill(); }, 10_000);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    for await (const chunk of proc.stdout) {
      const remaining = PATCH_LIMIT - size;
      chunks.push(chunk.subarray(0, Math.max(remaining, 0)));
      size += Math.min(chunk.byteLength, Math.max(remaining, 0));
      if (chunk.byteLength > remaining) {
        truncated = true;
        proc.kill();
        break;
      }
    }
    const code = await proc.exited;
    if (timedOut || (!truncated && code !== 0 && !(scope === "untracked" && code === 1))) {
      throw new GitDiffError("Git 변경사항을 읽지 못했습니다. 다시 시도해 주세요");
    }
  } finally {
    clearTimeout(timer);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const patch = new TextDecoder().decode(bytes);
  return { path: normalized, patch, truncated, binary: /^Binary files .* differ$/m.test(patch) };
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
