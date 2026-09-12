import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/** Lexical resolve, then realpath the deepest existing ancestor (so symlinks cannot escape). */
function resolveReal(path: string): string {
  const abs = resolve(path);
  let cursor = abs;
  const missing: string[] = [];
  while (!existsSync(cursor)) {
    missing.push(basename(cursor));
    const parent = dirname(cursor);
    if (parent === cursor) {
      throw new Error("path escapes workspace");
    }
    cursor = parent;
  }
  let real = realpathSync(cursor);
  for (const part of missing.reverse()) {
    real = join(real, part);
  }
  return real;
}

export function resolveWorkspacePath(workspace: string, requested: string): string {
  const root = resolveReal(workspace);
  const target = isAbsolute(requested) ? resolve(requested) : resolve(root, requested);
  const resolved = resolveReal(target);
  const rel = relative(root, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("path escapes workspace");
  }
  return resolved;
}

export function isInsideWorkspace(workspace: string, target: string): boolean {
  try {
    resolveWorkspacePath(workspace, target);
    return true;
  } catch {
    return false;
  }
}
