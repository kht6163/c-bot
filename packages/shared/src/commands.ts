/**
 * Slash commands the composer offers and the server runs. The catalog is
 * shared so the menu, `/help`, and the dispatcher can never drift apart.
 */
export type SlashCommandName =
  | "help"
  | "status"
  | "compact"
  | "clear"
  | "model"
  | "approvals"
  | "bots"
  | "init";

export interface SlashCommandSpec {
  name: SlashCommandName;
  /** Argument hint shown in the menu. Empty when the command takes none. */
  args: string;
  summary: string;
}

export const SLASH_COMMANDS: readonly SlashCommandSpec[] = [
  { name: "help", args: "", summary: "명령 목록을 본다" },
  { name: "status", args: "", summary: "세션·프로젝트·모델·컨텍스트 상태를 본다" },
  { name: "compact", args: "[지시]", summary: "지금까지 대화를 요약해 컨텍스트를 줄인다" },
  { name: "clear", args: "", summary: "모델 컨텍스트를 비운다 (로그는 남는다)" },
  { name: "model", args: "[모델 또는 프로바이더/모델]", summary: "쓰는 모델을 보거나 바꾼다" },
  { name: "approvals", args: "[prompt|allow]", summary: "위험 도구 승인 정책을 보거나 바꾼다" },
  { name: "bots", args: "", summary: "봇 로스터를 본다" },
  { name: "init", args: "", summary: "이 프로젝트의 AGENTS.md 초안을 쓰게 한다" },
];

export interface ParsedSlashCommand {
  name: SlashCommandName;
  args: string;
}

const COMMAND_RE = /^\/([a-z][a-z0-9-]*)(?:[ \t]+([\s\S]*))?$/;

export function isSlashCommandName(value: string): value is SlashCommandName {
  return SLASH_COMMANDS.some((command) => command.name === value);
}

/**
 * A message that is one known command, or null. An unknown `/word` and a path
 * like `/Users/me/app` are ordinary text: the model still gets to see them.
 */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const match = COMMAND_RE.exec(text.trim());
  const name = match?.[1];
  if (!name || !isSlashCommandName(name)) {
    return null;
  }
  return { name, args: (match?.[2] ?? "").trim() };
}

/** The command token being typed at the caret, or null. Only the first word counts. */
export function findActiveSlash(
  value: string,
  caret: number,
): { start: number; end: number; query: string } | null {
  if (!value.startsWith("/")) {
    return null;
  }
  const head = value.slice(1, caret);
  if (caret < 1 || /[\s]/.test(head)) {
    return null;
  }
  return { start: 0, end: caret, query: head };
}

export function filterSlashCommands(query: string): SlashCommandSpec[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return [...SLASH_COMMANDS];
  }
  return SLASH_COMMANDS.filter(
    (command) => command.name.startsWith(q) || command.summary.toLowerCase().includes(q),
  );
}
