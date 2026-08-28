/** Lucene CJKAnalyzer / Hermes fts5_cjk: unicode61 words + overlapping CJK bigrams. */

export function isCjkCodePoint(cp: number): boolean {
  return (
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x3130 && cp <= 0x318f) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xd7b0 && cp <= 0xd7ff) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x2fa1f) ||
    (cp >= 0x3040 && cp <= 0x309f) ||
    (cp >= 0x30a0 && cp <= 0x30ff) ||
    (cp >= 0x31f0 && cp <= 0x31ff)
  );
}

function isLatinWord(cp: number): boolean {
  if (isCjkCodePoint(cp)) {
    return false;
  }
  return /[\p{L}\p{N}_]/u.test(String.fromCodePoint(cp));
}

function emitCjkRun(run: string, out: string[]): void {
  if (run.length === 0) {
    return;
  }
  if (run.length === 1) {
    out.push(run);
    return;
  }
  for (let i = 0; i < run.length - 1; i += 1) {
    out.push(run.slice(i, i + 2));
  }
}

export function cjkTokens(text: string): string[] {
  const tokens: string[] = [];
  let latin = "";
  let cjk = "";
  const flushLatin = () => {
    if (latin.length > 0) {
      tokens.push(latin.toLowerCase());
      latin = "";
    }
  };
  const flushCjk = () => {
    emitCjkRun(cjk, tokens);
    cjk = "";
  };
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isCjkCodePoint(cp)) {
      flushLatin();
      cjk += ch;
    } else if (isLatinWord(cp)) {
      flushCjk();
      latin += ch;
    } else {
      flushLatin();
      flushCjk();
    }
  }
  flushLatin();
  flushCjk();
  return tokens;
}

export function cjkSearchText(text: string): string {
  return cjkTokens(text).join(" ");
}

export function cjkMatchQuery(text: string): string | undefined {
  const tokens = cjkTokens(text).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return undefined;
  }
  return tokens.map((token) => `"${token.replaceAll('"', "")}"`).join(" OR ");
}
