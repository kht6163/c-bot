import type { BotRecord } from "./types.ts";
import { PROTOCOL_HEADING } from "./types.ts";

export function protocolSection(me: BotRecord, roster: readonly BotRecord[], soul: string): string {
  if (soul.includes(PROTOCOL_HEADING)) {
    return "";
  }
  const others = roster.filter((bot) => bot.id !== me.id && !bot.hidden);
  const lines = others.map((bot) => {
    const role = [bot.title, bot.description].filter((part) => part.length > 0).join(" — ");
    return `- \`@${bot.handle}\`${role ? ` — ${role}` : ""}`;
  });
  return [
    PROTOCOL_HEADING,
    "",
    `You are \`@${me.handle}\`. Your teammates (live roster):`,
    lines.length > 0 ? lines.join("\n") : "- (none)",
    "",
    "To message a teammate, call `message_agent`. It is fire-and-forget: you get a delivery acknowledgement, you finish your turn, and their reply arrives later as a notification. Compose the message yourself; never paste the user's words verbatim. Message one relevant teammate unless the user asked to fan out.",
    "",
  ].join("\n");
}

export function withProtocol(system: string, section: string): string {
  if (section.length === 0) {
    return system;
  }
  return `${system}\n\n${section}`;
}
