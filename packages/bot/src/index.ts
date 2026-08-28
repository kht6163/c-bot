export {
  BOT_CHAT_TITLE,
  LEADER_HANDLE,
  MESSAGE_MAX_CHARS,
  PROTOCOL_HEADING,
  type BotProfile,
  type BotRecord,
  type BotRole,
} from "./types.ts";
export {
  createBot,
  deleteBot,
  ensureLeaderBot,
  findBotChat,
  findLeader,
  listBots,
  loadBot,
  updateBot,
  validateHandle,
} from "./roster.ts";
export { protocolSection, withProtocol } from "./protocol.ts";
export { attributedText, deliver, type MailboxAck, type MailboxSend } from "./mailbox.ts";
export { messageAgentTool, workspaceForMailbox, type MessageAgentDeps } from "./message-agent.ts";
