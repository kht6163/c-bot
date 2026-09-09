export interface DiffLine {
  kind: "meta" | "hunk" | "add" | "remove" | "context";
  text: string;
  before?: number;
  after?: number;
}

/** Only ordinary unified hunks have one old/new line number pair. */
export function diffLines(patch: string): DiffLine[] {
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let before = 0;
  let after = 0;
  let inHunk = false;
  return lines.map((text): DiffLine => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      before = Number(hunk[1]);
      after = Number(hunk[2]);
      inHunk = true;
      return { kind: "hunk", text };
    }
    if (text.startsWith("diff ") || text.startsWith("@@@")) inHunk = false;
    if (inHunk && text.startsWith("+")) return { kind: "add", text, after: after++ };
    if (inHunk && text.startsWith("-")) return { kind: "remove", text, before: before++ };
    if (inHunk && text.startsWith(" ")) {
      return { kind: "context", text, before: before++, after: after++ };
    }
    return { kind: "meta", text };
  });
}
