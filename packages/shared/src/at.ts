/** Active `@token` to the left of the caret, or null. */
export function findActiveAt(
  value: string,
  caret: number,
): { start: number; end: number; query: string } | null {
  let i = caret;
  while (i > 0) {
    const ch = value.charAt(i - 1);
    if (ch === "@") {
      const before = i >= 2 ? value.charAt(i - 2) : "";
      if (i === 1 || /\s/.test(before)) {
        return { start: i - 1, end: caret, query: value.slice(i, caret) };
      }
      return null;
    }
    if (/\s/.test(ch)) {
      return null;
    }
    i -= 1;
  }
  return null;
}

/** `@token`s in `text` that start after whitespace or string start. */
export function atTokens(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charAt(i) !== "@") {
      continue;
    }
    const before = i === 0 ? "" : text.charAt(i - 1);
    if (i > 0 && !/\s/.test(before)) {
      continue;
    }
    let end = i + 1;
    while (end < text.length && !/\s/.test(text.charAt(end))) {
      end += 1;
    }
    const token = text.slice(i + 1, end);
    if (token.length > 0) {
      out.push(token);
    }
    i = end - 1;
  }
  return out;
}
