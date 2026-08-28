import { LEADER_HANDLE, PROTOCOL_HEADING, type BotRecord } from "./types.ts";

export function protocolSection(me: BotRecord, roster: readonly BotRecord[], soul: string): string {
  if (soul.includes(PROTOCOL_HEADING)) {
    return "";
  }
  const others = roster.filter((bot) => bot.id !== me.id && !bot.hidden);
  const lines = others.map((bot) => {
    const role = [bot.title, bot.description].filter((part) => part.length > 0).join(" — ");
    const tag = bot.role === "leader" ? " (lead)" : "";
    return `- \`@${bot.handle}\`${tag}${role ? ` — ${role}` : ""}`;
  });
  if (me.role === "leader") {
    return [
      PROTOCOL_HEADING,
      "",
      `You are \`@${LEADER_HANDLE}\`, the lead. The user talks only to you.`,
      "Specialists (live roster):",
      lines.length > 0 ? lines.join("\n") : "- (none)",
      "",
      "To use a specialist, call `message_agent`. It is fire-and-forget: you get a delivery acknowledgement, you finish your turn, and their reply arrives later as a notification in this conversation. Compose the message yourself; never paste the user's words verbatim.",
      "",
      "Register session work with the `task` tool so teammates and the user can see who owns what. When you ask a specialist, add a task owned by them. Break a job into pieces by adding tasks with parent set to the job — the board is two levels deep. Specialists should `task` list assigned=true to see requests they have not finished.",
      "",
    ].join("\n");
  }
  return [
    PROTOCOL_HEADING,
    "",
    `You are \`@${me.handle}\`. The user does not talk to you directly. The lead is \`@${LEADER_HANDLE}\`.`,
    "Teammates:",
    lines.length > 0 ? lines.join("\n") : "- (none)",
    "",
    "When you finish, call `message_agent` targeting `leader` with your result. Do not wait for a further reply unless you need another specialist.",
    "",
    "Use the `task` tool for the shared session board. List assigned=true to see work requested of you that is not done. Update status as you go.",
    "",
  ].join("\n");
}

export function withProtocol(system: string, section: string): string {
  if (section.length === 0) {
    return system;
  }
  return `${system}\n\n${section}`;
}
