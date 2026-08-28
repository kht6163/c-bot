import { describe, expect, test } from "bun:test";
import { folderFromAbsoluteFile, fromFileList } from "./pick-folder.ts";

describe("folderFromAbsoluteFile", () => {
  test("strips the relative file under the chosen folder", () => {
    expect(folderFromAbsoluteFile("/Users/me/project/test/readme.md", "test/readme.md")).toBe(
      "/Users/me/project/test",
    );
    expect(folderFromAbsoluteFile("C:\\work\\app\\src\\a.ts", "app\\src\\a.ts")).toBe("C:/work/app");
  });
});

describe("fromFileList", () => {
  test("uses webkitRelativePath to name the folder and children", () => {
    const files = [
      { name: "a.ts", webkitRelativePath: "c-bot/src/a.ts" },
      { name: "b.ts", webkitRelativePath: "c-bot/src/b.ts" },
      { name: "readme.md", webkitRelativePath: "c-bot/readme.md" },
    ] as unknown as File[];
    expect(fromFileList(files)).toEqual({
      kind: "hint",
      name: "c-bot",
      children: ["src", "readme.md"],
    });
  });
});
