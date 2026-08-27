import { isAbsolute, relative, resolve } from "node:path";

export function resolveWorkspacePath(workspace: string, requested: string): string {
  const root = resolve(workspace);
  const target = isAbsolute(requested) ? resolve(requested) : resolve(root, requested);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("path escapes workspace");
  }
  return target;
}

export function isInsideWorkspace(workspace: string, target: string): boolean {
  try {
    resolveWorkspacePath(workspace, target);
    return true;
  } catch {
    return false;
  }
}
