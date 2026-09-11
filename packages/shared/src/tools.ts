/**
 * Tools a bot profile can switch on or off, in the order settings show them.
 * `message_agent` is absent on purpose: it is how bots reach each other, so
 * every bot keeps it.
 */
export const BOT_TOOLS = [
  "read_file",
  "list_dir",
  "grep",
  "glob",
  "write_file",
  "edit_file",
  "bash",
  "todo_write",
  "memory",
  "task",
] as const;

export type BotToolName = (typeof BOT_TOOLS)[number];

export function isBotToolName(value: string): value is BotToolName {
  return (BOT_TOOLS as readonly string[]).includes(value);
}

/**
 * The stored form of a tool choice: known names, once each, in catalog order.
 * Choosing every tool is the default and comes back as null, so a tool added
 * later reaches that bot too.
 */
export function normalizeBotTools(names: readonly string[]): BotToolName[] | null {
  const picked = BOT_TOOLS.filter((name) => names.includes(name));
  return picked.length === BOT_TOOLS.length ? null : picked;
}

/** True when a bot with this choice may use the tool. `null` is every tool. */
export function botToolEnabled(tools: readonly string[] | null, name: string): boolean {
  return tools === null || tools.includes(name);
}
