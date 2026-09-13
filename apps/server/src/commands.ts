import {
  compactSession,
  historyTokens,
  deriveMessages,
  forgetCommand,
  loadConfig,
  loadSecrets,
  projectName,
  resolveLlmEndpoint,
  saveConfig,
  type AppConfig,
} from "@cbot/agent";
import { listBots, updateBot } from "@cbot/bot";
import {
  SLASH_COMMANDS,
  normalizeRule,
  sessionProject,
  type ParsedSlashCommand,
  type SessionId,
  type SessionSummary,
} from "@cbot/shared";
import {
  acceptUserMessage,
  forgetSessionRules,
  isSessionBusy,
  sessionAllowRules,
  type Runtime,
} from "./runtime.ts";
import { runIssueCommand } from "./issue.ts";

const INIT_PROMPT = [
  "이 워크스페이스를 위한 AGENTS.md 초안을 써라.",
  "먼저 저장소를 읽어 실제로 쓰는 언어, 빌드·테스트 명령, 디렉터리 구조, 이미 있는 규칙을 확인한다.",
  "확인한 것만 적고, 없는 관행을 지어내지 않는다.",
  "AGENTS.md가 이미 있으면 새로 쓰지 말고 틀린 곳과 빠진 곳만 고친다.",
].join(" ");

/**
 * Runs one slash command. Commands answer in the log as `system/notice`, so
 * the transcript still explains itself on reload, but the model history is
 * untouched — a command is a control, not a message to the agent.
 */
export async function runSlashCommand(
  runtime: Runtime,
  sessionId: SessionId,
  session: SessionSummary,
  command: ParsedSlashCommand,
): Promise<void> {
  switch (command.name) {
    case "help":
      notice(runtime, sessionId, command.name, helpText());
      return;
    case "status":
      notice(runtime, sessionId, command.name, await statusText(runtime, sessionId, session));
      return;
    case "bots":
      notice(runtime, sessionId, command.name, await botsText(runtime));
      return;
    case "model":
      notice(runtime, sessionId, command.name, await modelText(runtime, command.args));
      return;
    case "approvals":
      notice(runtime, sessionId, command.name, await approvalsText(runtime, sessionId, command.args));
      return;
    case "clear":
      if (isSessionBusy(sessionId)) {
        notice(runtime, sessionId, command.name, "턴이 도는 중에는 컨텍스트를 비울 수 없습니다.");
        return;
      }
      runtime.store.append(sessionId, { type: "context/clear" });
      return;
    case "compact":
      await runCompact(runtime, sessionId, command.args);
      return;
    case "init":
      if (!session.workspace) {
        notice(runtime, sessionId, command.name, "프로젝트를 먼저 여세요.");
        return;
      }
      await acceptUserMessage(runtime, sessionId, INIT_PROMPT);
      return;
    case "issue":
      await runIssueCommand(runtime, sessionId, session, command.args);
      return;
  }
}

function notice(runtime: Runtime, sessionId: SessionId, command: string, text: string): void {
  runtime.store.append(sessionId, { type: "system/notice", command, text });
}

function helpText(): string {
  const lines = SLASH_COMMANDS.map((spec) => {
    const head = spec.args ? `/${spec.name} ${spec.args}` : `/${spec.name}`;
    return `- \`${head}\` — ${spec.summary}`;
  });
  return ["명령", ...lines, "", "그 밖의 `/`로 시작하는 글은 그대로 모델에게 갑니다."].join("\n");
}

async function statusText(
  runtime: Runtime,
  sessionId: SessionId,
  session: SessionSummary,
): Promise<string> {
  const config = await loadConfig(runtime.env.home);
  const secrets = await loadSecrets(runtime.env.home);
  const pin = await leaderPin(runtime);
  const endpoint = resolveLlmEndpoint(config, secrets, pin);
  const tokens = historyTokens(deriveMessages(runtime.store.events(sessionId)));
  const percent = Math.round((tokens / config.context.maxTokens) * 100);
  const project = sessionProject(session);
  return [
    "상태",
    `- 세션: ${session.title}`,
    `- 프로젝트: ${project ? projectName(project) : "없음"} (${project ?? "-"})`,
    ...(session.worktree
      ? [`- 워크트리: \`${session.worktree.branch}\` (${session.workspace ?? session.worktree.root})`]
      : []),
    `- 모델: ${endpoint ? `${pin?.provider ?? config.llm.activeProvider} / ${endpoint.model}` : "설정 없음"}`,
    `- 승인: ${config.approval.mode === "allow" ? "자동 허용" : "물어봄"}`,
    `- 컨텍스트: 약 ${tokens.toLocaleString("en-US")} / ${config.context.maxTokens.toLocaleString("en-US")} 토큰 (${percent}%)`,
    `- 자동 요약: ${config.context.autoCompact ? `${Math.round(config.context.compactAt * 100)}%에서` : "끔"}`,
  ].join("\n");
}

async function botsText(runtime: Runtime): Promise<string> {
  const roster = await listBots(runtime.env.home);
  if (roster.length === 0) {
    return "로스터가 비었습니다.";
  }
  const lines = roster.map(
    (bot) =>
      `- \`@${bot.handle}\` — ${bot.title}${bot.role === "leader" ? " (리드)" : ""}${
        bot.description ? ` — ${bot.description}` : ""
      }`,
  );
  return ["로스터", ...lines].join("\n");
}

async function modelText(runtime: Runtime, args: string): Promise<string> {
  const config = await loadConfig(runtime.env.home);
  if (args.length === 0) {
    return describeModels(config);
  }
  const [head, ...rest] = args.split("/");
  const wanted = rest.length > 0 ? rest.join("/") : (head ?? "");
  const providerId = rest.length > 0 ? (head ?? "") : null;
  const candidates = providerId
    ? config.llm.providers.filter((provider) => provider.id === providerId)
    : config.llm.providers;
  const hit = candidates.find((provider) => provider.models.includes(wanted));
  if (!hit) {
    return [`\`${args}\` 은 설정에 없는 모델입니다.`, "", describeModels(config)].join("\n");
  }
  const thinking = hit.thinking[wanted]?.[0] ?? null;
  await saveConfig(runtime.env.home, {
    ...config,
    llm: { ...config.llm, activeProvider: hit.id, activeModel: wanted, activeThinking: thinking },
  });
  // A pinned leader outranks the global default, so the pin has to move too or
  // the coding session would keep running the old model.
  const leader = (await listBots(runtime.env.home)).find((bot) => bot.role === "leader");
  if (leader?.model) {
    await updateBot(runtime.env.home, leader.id, {
      provider: hit.id,
      model: wanted,
      thinking,
    });
  }
  return `모델을 \`${hit.id} / ${wanted}\` 로 바꿨습니다.`;
}

function describeModels(config: AppConfig): string {
  if (config.llm.providers.length === 0) {
    return "설정에 프로바이더가 없습니다. 설정 → 모델에서 추가하세요.";
  }
  const active = `현재: ${
    config.llm.activeProvider && config.llm.activeModel
      ? `\`${config.llm.activeProvider} / ${config.llm.activeModel}\``
      : "없음"
  }`;
  const lines = config.llm.providers.map(
    (provider) => `- \`${provider.id}\` — ${provider.models.join(", ") || "모델 없음"}`,
  );
  return [active, "", "쓸 수 있는 모델", ...lines].join("\n");
}

async function approvalsText(runtime: Runtime, sessionId: SessionId, args: string): Promise<string> {
  const config = await loadConfig(runtime.env.home);
  if (args.length === 0) {
    const always = config.approval.allow.map((rule) => `\`${rule}\``).join(", ");
    const session = sessionAllowRules(sessionId)
      .map((rule) => `\`${rule}\``)
      .join(", ");
    return [
      `승인 정책: ${config.approval.mode === "allow" ? "`allow` — 바로 실행" : "`prompt` — 카드로 물어봄"}`,
      "",
      `- 항상 허용: ${always || "(없음)"}`,
      `- 이 세션에서 허용: ${session || "(없음)"}`,
    ].join("\n");
  }
  if (args === "allow" || args === "prompt") {
    await saveConfig(runtime.env.home, { ...config, approval: { ...config.approval, mode: args } });
    return args === "allow"
      ? "승인 정책을 `allow` 로 바꿨습니다. `bash` 같은 위험 도구가 묻지 않고 실행됩니다."
      : "승인 정책을 `prompt` 로 바꿨습니다. 위험 도구는 카드로 묻습니다.";
  }
  const forget = /^forget\s+(.+)$/.exec(args);
  if (forget) {
    const rule = normalizeRule(forget[1] ?? "");
    if (!config.approval.allow.includes(rule)) {
      return `\`${rule}\` 은 항상 허용 목록에 없습니다.`;
    }
    await saveConfig(runtime.env.home, forgetCommand(config, rule));
    return `\`${rule}\` 을 항상 허용 목록에서 뺐습니다.`;
  }
  if (args === "reset") {
    forgetSessionRules(sessionId);
    return "이 세션에서 허용한 명령을 모두 지웠습니다.";
  }
  return "`/approvals`, `/approvals prompt|allow`, `/approvals forget <명령>`, `/approvals reset` 으로 씁니다.";
}

async function runCompact(runtime: Runtime, sessionId: SessionId, args: string): Promise<void> {
  if (isSessionBusy(sessionId)) {
    notice(runtime, sessionId, "compact", "턴이 도는 중에는 요약할 수 없습니다. 끝난 뒤 다시 부르세요.");
    return;
  }
  const config = await loadConfig(runtime.env.home);
  const secrets = await loadSecrets(runtime.env.home);
  const endpoint = resolveLlmEndpoint(config, secrets, await leaderPin(runtime));
  const result = await compactSession(sessionId, {
    store: runtime.store,
    llm: runtime.llm,
    apiKey: endpoint?.apiKey,
    baseURL: endpoint?.baseURL ?? "",
    model: endpoint?.model ?? "",
    keepRecentTurns: 0,
    auto: false,
    ...(args ? { instruction: args } : {}),
  });
  if (!result.ok) {
    notice(
      runtime,
      sessionId,
      "compact",
      result.reason === "nothing_to_compact"
        ? "아직 요약할 만큼 대화가 쌓이지 않았습니다."
        : `요약하지 못했습니다. [reason: ${result.reason}]`,
    );
  }
}

async function leaderPin(
  runtime: Runtime,
): Promise<{ provider?: string | null; model?: string | null } | undefined> {
  const leader = (await listBots(runtime.env.home)).find((bot) => bot.role === "leader");
  return leader ? { provider: leader.provider, model: leader.model } : undefined;
}
