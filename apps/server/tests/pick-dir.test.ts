import { describe, expect, test } from "bun:test";
import { pickNativeDirectory, type CommandRunner } from "../src/pick-dir.ts";

function runner(map: Record<string, { code: number; stdout?: string; stderr?: string; missing?: boolean }>): CommandRunner {
  return async (cmd) => {
    const hit = map[cmd];
    if (!hit) {
      return { code: 127, stdout: "", stderr: "", missing: true };
    }
    return {
      code: hit.code,
      stdout: hit.stdout ?? "",
      stderr: hit.stderr ?? "",
      ...(hit.missing ? { missing: true } : {}),
    };
  };
}

describe("pickNativeDirectory", () => {
  test("darwin returns a POSIX path and treats user cancel as null", async () => {
    expect(
      await pickNativeDirectory(
        "darwin",
        runner({ osascript: { code: 0, stdout: "/Users/me/agent-all/\n" } }),
      ),
    ).toBe("/Users/me/agent-all");
    expect(
      await pickNativeDirectory(
        "darwin",
        runner({ osascript: { code: 1, stderr: "User canceled. (-128)\n" } }),
      ),
    ).toBeNull();
  });

  test("linux prefers zenity then kdialog", async () => {
    expect(
      await pickNativeDirectory(
        "linux",
        runner({ zenity: { code: 0, stdout: "/home/me/proj\n" } }),
      ),
    ).toBe("/home/me/proj");
    expect(
      await pickNativeDirectory(
        "linux",
        runner({
          zenity: { code: 127, missing: true },
          kdialog: { code: 0, stdout: "/home/me/other\n" },
        }),
      ),
    ).toBe("/home/me/other");
    await expect(
      pickNativeDirectory(
        "linux",
        runner({ zenity: { code: 127, missing: true }, kdialog: { code: 127, missing: true } }),
      ),
    ).rejects.toThrow(/unavailable/);
  });

  test("win32 empty output is cancel", async () => {
    expect(
      await pickNativeDirectory("win32", runner({ "powershell.exe": { code: 0, stdout: "" } })),
    ).toBeNull();
    expect(
      await pickNativeDirectory(
        "win32",
        runner({ "powershell.exe": { code: 0, stdout: "C:\\work\\app\r\n" } }),
      ),
    ).toBe("C:\\work\\app");
  });
});
