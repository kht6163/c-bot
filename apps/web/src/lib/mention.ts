export type MentionOption =
  | { kind: "bot"; handle: string; title: string }
  | { kind: "file"; path: string };

export function filterMentionOptions(
  query: string,
  bots: readonly { handle: string; title: string; role: "leader" | "specialist" }[],
  files: readonly string[],
): MentionOption[] {
  const q = query.trim().toLowerCase();
  const botHits: MentionOption[] = bots
    .filter((bot) => {
      if (q.length === 0) {
        return true;
      }
      return bot.handle.toLowerCase().includes(q) || bot.title.toLowerCase().includes(q);
    })
    .map((bot) => ({ kind: "bot", handle: bot.handle, title: bot.title }));
  const fileHits: MentionOption[] = files.map((path) => ({ kind: "file", path }));
  return [...botHits, ...fileHits].slice(0, 40);
}

export function insertMention(
  value: string,
  range: { start: number; end: number },
  token: string,
): { text: string; caret: number } {
  const inserted = `@${token} `;
  const text = `${value.slice(0, range.start)}${inserted}${value.slice(range.end)}`;
  return { text, caret: range.start + inserted.length };
}
