import { describe, expect, test } from "bun:test";
import { filterMentionOptions, insertMention } from "./mention.ts";

describe("filterMentionOptions", () => {
  const bots = [
    { handle: "leader", title: "Lead", role: "leader" as const },
    { handle: "researcher", title: "Researcher", role: "specialist" as const },
  ];

  test("puts matching bots before files", () => {
    const options = filterMentionOptions("re", bots, ["src/read.ts", "README.md"]);
    expect(options.map((item) => (item.kind === "bot" ? item.handle : item.path))).toEqual([
      "researcher",
      "src/read.ts",
      "README.md",
    ]);
  });
});

describe("insertMention", () => {
  test("replaces the active @query and leaves a trailing space", () => {
    expect(insertMention("see @fo", { start: 4, end: 7 }, "src/foo.ts")).toEqual({
      text: "see @src/foo.ts ",
      caret: 16,
    });
  });
});
