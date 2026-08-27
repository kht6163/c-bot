export function folderName(path: string): string {
  const parts = path.split(/[/\\]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? path;
}

export function projectPaths(input: {
  current: string | null;
  recents: string[];
}): string[] {
  const rest = input.recents.filter((path) => path !== input.current);
  return input.current ? [input.current, ...rest] : rest;
}

export function projectTree<T extends { workspace: string | null; updatedAt: string }>(
  project: { current: string | null; recents: string[] },
  sessions: readonly T[],
): { path: string; name: string; sessions: T[] }[] {
  const listed = new Set<string>();
  const paths: string[] = [];
  for (const path of projectPaths(project)) {
    listed.add(path);
    paths.push(path);
  }
  for (const session of sessions) {
    const path = session.workspace;
    if (!path || listed.has(path)) {
      continue;
    }
    listed.add(path);
    paths.push(path);
  }
  return paths.map((path) => ({
    path,
    name: folderName(path),
    sessions: sessions
      .filter((session) => session.workspace === path)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
  }));
}

export function timeAgo(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) {
    return "";
  }
  const ms = Math.max(0, now - then);
  if (ms < 60_000) {
    return "방금";
  }
  if (ms < 3_600_000) {
    return `${Math.floor(ms / 60_000)}분`;
  }
  if (ms < 86_400_000) {
    return `${Math.floor(ms / 3_600_000)}시간`;
  }
  if (ms < 7 * 86_400_000) {
    return `${Math.floor(ms / 86_400_000)}일`;
  }
  return new Date(then).toLocaleDateString("ko-KR");
}
