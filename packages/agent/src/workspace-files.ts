import { readFile, stat } from "node:fs/promises";
import type { AttachedFile } from "@cbot/shared";
import { SKIP_DIR_NAMES } from "./tools/search.ts";
import { resolveWorkspacePath } from "./tools/path.ts";

const SCAN_CAP = 800;
const RESULT_CAP = 32;

export async function searchWorkspaceFiles(
  workspace: string,
  query: string,
  limit = RESULT_CAP,
): Promise<string[]> {
  const glob = new Bun.Glob("**/*");
  const q = query.trim().toLowerCase();
  const scored: { path: string; score: number }[] = [];
  for await (const match of glob.scan({ cwd: workspace, dot: false, onlyFiles: true })) {
    if (match.split(/[\\/]/).some((part) => SKIP_DIR_NAMES.has(part))) {
      continue;
    }
    const score = scorePath(match, q);
    if (score === null) {
      continue;
    }
    scored.push({ path: match, score });
    if (scored.length >= SCAN_CAP) {
      break;
    }
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return scored.slice(0, limit).map((item) => item.path);
}

const FILE_BYTES = 96 * 1024;
const FILE_COUNT = 8;
const BINARY_NAME = /\.(png|jpe?g|gif|webp|pdf|zip|gz|woff2?|exe|dylib|so|bin|ico)$/i;

export async function loadMentionedFiles(
  workspace: string,
  tokens: readonly string[],
  skip: ReadonlySet<string>,
): Promise<AttachedFile[]> {
  const files: AttachedFile[] = [];
  for (const token of tokens) {
    if (skip.has(token) || BINARY_NAME.test(token)) {
      continue;
    }
    try {
      const abs = resolveWorkspacePath(workspace, token);
      const info = await stat(abs);
      if (!info.isFile() || info.size > FILE_BYTES) {
        continue;
      }
      const content = await readFile(abs, "utf8");
      if (content.includes("\0")) {
        continue;
      }
      files.push({ path: token.replace(/\\/g, "/"), content });
    } catch {
      continue;
    }
    if (files.length >= FILE_COUNT) {
      break;
    }
  }
  return files;
}

function scorePath(path: string, query: string): number | null {
  const lower = path.toLowerCase();
  const base = (path.split(/[\\/]/).at(-1) ?? path).toLowerCase();
  if (query.length === 0) {
    const depth = path.split(/[\\/]/).length;
    return 100 - depth;
  }
  if (base.startsWith(query)) {
    return 300 - path.length;
  }
  if (base.includes(query)) {
    return 200 - path.length;
  }
  if (lower.includes(query)) {
    return 100 - path.length;
  }
  const tokens = query.split(/[\s/]+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => lower.includes(token))) {
    return 80 - path.length;
  }
  return null;
}
