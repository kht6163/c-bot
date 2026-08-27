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
