import { BOT_TOOLS, normalizeBotTools, type BotToolName } from "@cbot/shared";

export interface ToolGroup {
  label: string;
  tools: readonly BotToolName[];
  /** Shown on and cannot be switched off. */
  locked?: readonly string[];
}

/** How bot settings lay out the tool choice. Every choice appears once. */
export const TOOL_GROUPS: readonly ToolGroup[] = [
  { label: "읽기", tools: ["read_file", "list_dir", "grep", "glob"] },
  { label: "쓰기·실행", tools: ["write_file", "edit_file", "bash", "github_create_pr"] },
  { label: "기록·협업", tools: ["todo_write", "memory", "task"], locked: ["message_agent"] },
];

export const TOOL_HINTS: Record<BotToolName | "message_agent", string> = {
  read_file: "파일 읽기",
  list_dir: "폴더 안 목록 보기",
  grep: "파일 내용 검색",
  glob: "파일 이름으로 찾기",
  write_file: "파일 만들기·덮어쓰기",
  edit_file: "파일 일부 고치기",
  bash: "셸 명령 실행",
  github_create_pr: "브랜치 push 후 드래프트 PR (리드만, 승인 필요)",
  todo_write: "턴 안에서 쓰는 할 일 메모",
  memory: "이 봇의 메모리 찾기·기록",
  task: "세션 작업 보드 등록·수정",
  message_agent: "봇끼리 말하는 통로라 늘 켜져 있습니다",
};

/** The choice after switching one tool; switching the last one back on is the default again. */
export function toggleBotTool(
  tools: readonly BotToolName[] | null,
  name: BotToolName,
): BotToolName[] | null {
  const on = tools ?? BOT_TOOLS;
  return normalizeBotTools(on.includes(name) ? on.filter((item) => item !== name) : [...on, name]);
}

export function toolsOff(tools: readonly BotToolName[] | null): number {
  return tools === null ? 0 : BOT_TOOLS.length - tools.length;
}
