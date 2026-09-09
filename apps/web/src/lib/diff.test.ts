import { expect, test } from "bun:test";
import { diffLines } from "./diff.ts";

test("unified hunks number old and new lines independently, including header-like content", () => {
  const lines = diffLines("--- a/file\n+++ b/file\n@@ -3,2 +3,3 @@\n same\n---old\n+++new\n+extra\n\\ No newline at end of file\n@@ -20 +21 @@\n-x\n+y\n");
  expect(lines.slice(3,7)).toEqual([
    { kind: "context", text: " same", before: 3, after: 3 },
    { kind: "remove", text: "---old", before: 4 },
    { kind: "add", text: "+++new", after: 4 },
    { kind: "add", text: "+extra", after: 5 },
  ]);
  expect(lines.at(-1)).toEqual({ kind: "add", text: "+y", after: 21 });
  expect(lines[0]?.kind).toBe("meta");
});

test("empty and metadata-only patches do not invent changed lines", () => {
  expect(diffLines("")).toEqual([]);
  expect(diffLines("old mode 100644\nnew mode 100755\n").every(l => l.kind === "meta")).toBe(true);
});
