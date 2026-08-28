import { describe, expect, test } from "bun:test";
import { parseGitStatus } from "../src/git-status.ts";

describe("parseGitStatus", () => {
  test("reads branch, ahead, and porcelain files", () => {
    const parsed = parseGitStatus(
      [
        "## main...origin/main [ahead 4]",
        " M apps/web/src/App.tsx",
        "?? notes.md",
        "A  added.txt",
      ].join("\n"),
    );
    expect(parsed.branch).toBe("main");
    expect(parsed.upstream).toBe("origin/main");
    expect(parsed.ahead).toBe(4);
    expect(parsed.behind).toBe(0);
    expect(parsed.files.map((item) => item.label)).toEqual(["수정", "추적 안 함", "추가"]);
    expect(parsed.files[0]?.path).toBe("apps/web/src/App.tsx");
  });
});
