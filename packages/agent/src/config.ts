import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface AppConfig {
  llm: {
    baseURL: string;
    model: string;
  };
  approval: {
    mode: "prompt" | "allow";
  };
  botMode: {
    protocol: boolean;
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  llm: {
    baseURL: "https://api.x.ai/v1",
    model: "grok-4.6",
  },
  approval: {
    mode: "prompt",
  },
  botMode: {
    protocol: true,
  },
};

export function configPath(home: string): string {
  return join(home, "config.yaml");
}

export function sessionsDbPath(home: string): string {
  return join(home, "sessions", "sessions.sqlite");
}

export function secretsPath(home: string): string {
  return join(home, ".env");
}

export async function ensureHome(home: string): Promise<void> {
  await mkdir(join(home, "sessions"), { recursive: true });
  await mkdir(join(home, "bots"), { recursive: true });
  const path = configPath(home);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, serializeConfig(DEFAULT_CONFIG));
  }
}

export async function loadConfig(home: string): Promise<AppConfig> {
  await ensureHome(home);
  const path = configPath(home);
  const raw = await Bun.file(path).text();
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(raw);
  } catch (err) {
    throw new Error(`invalid config.yaml: ${String(err)}`);
  }
  return mergeConfig(parsed);
}

export async function saveConfig(home: string, config: AppConfig): Promise<void> {
  await ensureHome(home);
  await Bun.write(configPath(home), serializeConfig(config));
}

export function mergeConfig(parsed: unknown): AppConfig {
  const obj = isRecord(parsed) ? parsed : {};
  const llm = isRecord(obj.llm) ? obj.llm : {};
  const approval = isRecord(obj.approval) ? obj.approval : {};
  const botMode = isRecord(obj.botMode) ? obj.botMode : {};
  const mode = approval.mode === "allow" ? "allow" : "prompt";
  return {
    llm: {
      baseURL: str(llm.baseURL, DEFAULT_CONFIG.llm.baseURL),
      model: str(llm.model, DEFAULT_CONFIG.llm.model),
    },
    approval: { mode },
    botMode: {
      protocol: botMode.protocol === false ? false : true,
    },
  };
}

function serializeConfig(config: AppConfig): string {
  return [
    "llm:",
    `  baseURL: ${yamlScalar(config.llm.baseURL)}`,
    `  model: ${yamlScalar(config.llm.model)}`,
    "approval:",
    `  mode: ${config.approval.mode}`,
    "botMode:",
    `  protocol: ${config.botMode.protocol}`,
    "",
  ].join("\n");
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}
