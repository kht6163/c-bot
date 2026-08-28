import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export async function resolvePickedDirectory(input: {
  name: string;
  children: string[];
  roots: string[];
}): Promise<string | undefined> {
  const name = input.name.trim();
  if (!name || name === "." || name === "..") {
    return undefined;
  }
  const wanted = input.children
    .map((item) => item.replace(/[/\\]+$/g, "").trim())
    .filter((item) => item.length > 0 && item !== "." && item !== "..");
  const candidates = new Set<string>();
  for (const root of input.roots) {
    if (!root.trim()) {
      continue;
    }
    const resolved = resolve(root.trim());
    candidates.add(resolved);
    candidates.add(join(resolved, name));
    candidates.add(join(dirname(resolved), name));
  }
  const matches: string[] = [];
  for (const candidate of candidates) {
    if (basename(candidate) !== name) {
      continue;
    }
    const info = await stat(candidate).catch(() => null);
    if (!info?.isDirectory()) {
      continue;
    }
    if (wanted.length > 0 && !(await hasChildren(candidate, wanted))) {
      continue;
    }
    matches.push(candidate);
  }
  if (matches.length === 0) {
    return undefined;
  }
  for (const root of input.roots) {
    const resolved = resolve(root.trim());
    if (matches.includes(resolved)) {
      return resolved;
    }
  }
  matches.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return matches[0];
}

async function hasChildren(dir: string, wanted: string[]): Promise<boolean> {
  const names = new Set(await readdir(dir).catch(() => []));
  return wanted.every((item) => names.has(item));
}
