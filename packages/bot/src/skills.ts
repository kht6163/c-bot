import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { BotId } from "@cbot/shared";
import { botsDir } from "./roster.ts";

export const SKILLS_HEADING = "## Skills";
/** A skill longer than this is cut; the prompt says so, the file is left alone. */
export const SKILL_MAX_CHARS = 20_000;

export interface BotSkill {
  name: string;
  body: string;
}

export function skillsDir(home: string, botId: BotId): string {
  return join(botsDir(home), botId, "skills");
}

/**
 * Skills are markdown the user drops into `bots/<id>/skills/`: either
 * `<name>.md` or `<name>/SKILL.md`. Order is by name so the prompt bytes only
 * move when a file does.
 */
export async function loadSkills(home: string, botId: BotId): Promise<BotSkill[]> {
  const dir = skillsDir(home, botId);
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // No skills directory yet: an older bot, or one whose folder the user removed.
    return [];
  }
  const found: { name: string; path: string }[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      found.push({ name: entry.name.slice(0, -3), path: join(dir, entry.name) });
    } else if (entry.isDirectory()) {
      const path = join(dir, entry.name, "SKILL.md");
      if (await Bun.file(path).exists()) {
        found.push({ name: entry.name, path });
      }
    }
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  const out: BotSkill[] = [];
  for (const item of found) {
    const body = (await Bun.file(item.path).text()).trim();
    if (body.length === 0) {
      continue;
    }
    out.push({
      name: item.name,
      body:
        body.length > SKILL_MAX_CHARS
          ? `${body.slice(0, SKILL_MAX_CHARS)}\n\n(… ${item.name} 은 ${SKILL_MAX_CHARS}자에서 잘렸습니다)`
          : body,
    });
  }
  return out;
}

export function skillsSection(skills: readonly BotSkill[]): string {
  if (skills.length === 0) {
    return "";
  }
  const parts = skills.map((skill) => `### ${skill.name}\n\n${skill.body}`);
  return [SKILLS_HEADING, "", "Follow these when the task calls for them.", "", ...parts, ""].join(
    "\n\n",
  );
}
