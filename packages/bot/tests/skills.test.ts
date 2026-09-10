import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { SessionStore } from "@cbot/agent";
import { createBot, loadBot } from "../src/roster.ts";
import { SKILL_MAX_CHARS, loadSkills, skillsDir, skillsSection } from "../src/skills.ts";

async function botHome() {
  const home = await mkdtemp(join(tmpdir(), "cbot-skills-"));
  const store = await SessionStore.open(":memory:");
  const bot = await createBot(home, store, { handle: "writer", title: "Writer", description: "" });
  store.close();
  return { home, bot };
}

describe("bot skills", () => {
  test("loads <name>.md and <name>/SKILL.md sorted by name, ignoring the rest", async () => {
    const { home, bot } = await botHome();
    const dir = skillsDir(home, bot.id);
    await Bun.write(join(dir, "zeta.md"), "# Zeta\n\nlast\n");
    await mkdir(join(dir, "alpha"), { recursive: true });
    await Bun.write(join(dir, "alpha", "SKILL.md"), "first");
    await mkdir(join(dir, "empty-dir"), { recursive: true });
    await Bun.write(join(dir, "notes.txt"), "not a skill");
    await Bun.write(join(dir, ".hidden.md"), "no");
    await Bun.write(join(dir, "blank.md"), "  \n");
    const skills = await loadSkills(home, bot.id);
    expect(skills.map((skill) => skill.name)).toEqual(["alpha", "zeta"]);
    expect(skills[0]?.body).toBe("first");
    const loaded = await loadBot(home, bot.id);
    expect(loaded?.skills).toEqual(["alpha", "zeta"]);
  });

  test("a bot without a skills folder has none", async () => {
    const { home } = await botHome();
    expect(await loadSkills(home, "bot_missing" as never)).toEqual([]);
  });

  test("cuts an oversized skill and says so", async () => {
    const { home, bot } = await botHome();
    await Bun.write(join(skillsDir(home, bot.id), "big.md"), "x".repeat(SKILL_MAX_CHARS + 50));
    const [big] = await loadSkills(home, bot.id);
    expect(big?.body.length).toBeLessThan(SKILL_MAX_CHARS + 100);
    expect(big?.body).toContain("잘렸습니다");
  });

  test("the section is empty without skills and byte-stable with them", () => {
    expect(skillsSection([])).toBe("");
    const a = skillsSection([{ name: "review", body: "look twice" }]);
    const b = skillsSection([{ name: "review", body: "look twice" }]);
    expect(a).toBe(b);
    expect(a).toContain("## Skills");
    expect(a).toContain("### review");
    expect(a).toContain("look twice");
  });
});
