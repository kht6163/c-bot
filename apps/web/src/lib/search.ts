/** True when every whitespace-separated token of `query` appears in `text`. */
export function matchesQuery(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return true;
  }
  const hay = text.toLowerCase();
  return q.split(/\s+/).every((token) => hay.includes(token));
}
