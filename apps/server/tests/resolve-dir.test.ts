import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { resolvePickedDirectory } from "../src/resolve-dir.ts";

describe("resolvePickedDirectory", () => {
  test("matches a sibling of the launch directory by name and children", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-pick-"));
    const launch = join(home, "c-bot");
    const other = join(home, "test");
    await mkdir(launch, { recursive: true });
    await mkdir(other, { recursive: true });
    await writeFile(join(other, "test.txt"), "ok");
    const found = await resolvePickedDirectory({
      name: "test",
      children: ["test.txt"],
      roots: [launch],
    });
    expect(found).toBe(other);
  });
});
