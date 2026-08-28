import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CLIPROXYAPI_ID,
  isShippedId,
  looksLikeCliproxy,
  sanitizeThinking,
  shippedProvider,
  type ProviderKind,
} from "./catalog.ts";

export interface LlmProvider {
  id: string;
  displayName: string;
  baseURL: string;
  kind: ProviderKind;
  models: string[];
  thinking: Record<string, string[]>;
}

export interface AppConfig {
  llm: {
    activeProvider: string | null;
    activeModel: string | null;
    activeThinking: string | null;
    providers: LlmProvider[];
  };
  approval: {
    mode: "prompt" | "allow";
  };
  botMode: {
    protocol: boolean;
  };
  project: {
    current: string | null;
    recents: string[];
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  llm: {
    activeProvider: null,
    activeModel: null,
    activeThinking: null,
    providers: [],
  },
  approval: {
    mode: "prompt",
  },
  botMode: {
    protocol: true,
  },
  project: {
    current: null,
    recents: [],
  },
};

export const MAX_PROJECT_RECENTS = 8;
export const PROVIDER_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function configPath(home: string): string {
  return join(home, "config.yaml");
}

export function sessionsDbPath(home: string): string {
  return join(home, "sessions", "sessions.sqlite");
}

export function secretsPath(home: string): string {
  return join(home, ".env");
}

export function keyEnvName(id: string): string {
  return `${id.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_API_KEY`;
}

export function validateProviderId(id: string): string {
  const trimmed = id.trim().toLowerCase();
  if (!PROVIDER_ID_RE.test(trimmed)) {
    throw new Error("provider id must start with a letter and use lowercase letters, digits, and hyphen");
  }
  return trimmed;
}

export async function ensureHome(home: string): Promise<void> {
  await mkdir(join(home, "sessions"), { recursive: true });
  await mkdir(join(home, "bots"), { recursive: true });
  await mkdir(join(home, "tasks"), { recursive: true });
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
  const merged = mergeConfig(parsed);
  if (isLegacyLlm(parsed) || shouldRewriteProviders(parsed, merged)) {
    await saveConfig(home, merged);
  }
  return merged;
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
  const project = isRecord(obj.project) ? obj.project : {};
  const mode = approval.mode === "allow" ? "allow" : "prompt";
  const recents = Array.isArray(project.recents)
    ? project.recents.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const providers = promoteCliproxy(parseProviders(llm.providers));
  const adopted = providers.length === 0 ? legacyProvider(llm) : undefined;
  const list = adopted ? promoteCliproxy([adopted]) : providers;
  const activeProviderRaw =
    typeof llm.activeProvider === "string" && llm.activeProvider.trim()
      ? llm.activeProvider.trim()
      : (adopted?.id ?? null);
  const activeProvider =
    activeProviderRaw === "custom" && list.some((item) => item.id === CLIPROXYAPI_ID)
      ? CLIPROXYAPI_ID
      : activeProviderRaw;
  const activeModel =
    typeof llm.activeModel === "string" && llm.activeModel.trim()
      ? llm.activeModel.trim()
      : (adopted?.models[0] ?? null);
  const active = list.find((item) => item.id === activeProvider);
  const resolvedModel =
    activeModel && list.some((item) => item.models.includes(activeModel))
      ? activeModel
      : (active?.models[0] ?? null);
  const thinkingLevels = active && resolvedModel ? (active.thinking[resolvedModel] ?? []) : [];
  const activeThinking =
    typeof llm.activeThinking === "string" && thinkingLevels.includes(llm.activeThinking)
      ? llm.activeThinking
      : (thinkingLevels[0] ?? null);
  return {
    llm: {
      activeProvider: list.some((item) => item.id === activeProvider) ? activeProvider : null,
      activeModel: resolvedModel,
      activeThinking,
      providers: list,
    },
    approval: { mode },
    botMode: {
      protocol: botMode.protocol === false ? false : true,
    },
    project: {
      current: typeof project.current === "string" && project.current.trim() ? project.current.trim() : null,
      recents,
    },
  };
}

export function upsertProvider(
  config: AppConfig,
  provider: {
    id: string;
    displayName: string;
    baseURL: string;
    models: string[];
    thinking?: Record<string, string[]>;
  },
): AppConfig {
  const id = validateProviderId(provider.id);
  const catalog = shippedProvider(id);
  const next: LlmProvider = {
    id,
    displayName: provider.displayName.trim() || catalog?.displayName || id,
    baseURL: provider.baseURL.trim().replace(/\/+$/, "") || catalog?.baseURL || "",
    kind: catalog ? "shipped" : "custom",
    models: uniqueModels(provider.models),
    thinking: { ...(provider.thinking ?? {}) },
  };
  const others = config.llm.providers.filter((item) => item.id !== id);
  const providers = [...others, next].sort((a, b) => a.id.localeCompare(b.id));
  let activeProvider = config.llm.activeProvider;
  let activeModel = config.llm.activeModel;
  let activeThinking = config.llm.activeThinking;
  if (!activeProvider || !providers.some((item) => item.id === activeProvider)) {
    activeProvider = id;
    activeModel = next.models[0] ?? null;
    activeThinking = activeModel ? (next.thinking[activeModel]?.[0] ?? null) : null;
  } else if (activeProvider === id && (!activeModel || !next.models.includes(activeModel))) {
    activeModel = next.models[0] ?? null;
    activeThinking = activeModel ? (next.thinking[activeModel]?.[0] ?? null) : null;
  }
  return { ...config, llm: { activeProvider, activeModel, activeThinking, providers } };
}

export function removeProvider(config: AppConfig, id: string): AppConfig {
  const providers = config.llm.providers.filter((item) => item.id !== id);
  const activeProvider = config.llm.activeProvider === id ? (providers[0]?.id ?? null) : config.llm.activeProvider;
  const active = providers.find((item) => item.id === activeProvider);
  return {
    ...config,
    llm: {
      activeProvider,
      activeModel: active?.models[0] ?? null,
      activeThinking: active?.models[0] ? (active.thinking[active.models[0]]?.[0] ?? null) : null,
      providers,
    },
  };
}

export function rememberProject(config: AppConfig, path: string): AppConfig {
  const recents = config.project.recents.includes(path)
    ? config.project.recents
    : [...config.project.recents, path].slice(-MAX_PROJECT_RECENTS);
  return { ...config, project: { current: path, recents } };
}

export function forgetProject(config: AppConfig, path: string): AppConfig {
  const recents = config.project.recents.filter((item) => item !== path);
  const current = config.project.current === path ? (recents[0] ?? null) : config.project.current;
  return { ...config, project: { current, recents } };
}

export function projectName(path: string | null): string | null {
  if (!path) {
    return null;
  }
  const parts = path.split(/[/\\]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? path;
}

function shouldRewriteProviders(parsed: unknown, merged: AppConfig): boolean {
  if (!isRecord(parsed) || !isRecord(parsed.llm) || !isRecord(parsed.llm.providers)) {
    return false;
  }
  return (
    Object.keys(parsed.llm.providers).includes("custom") &&
    merged.llm.providers.some((item) => item.id === CLIPROXYAPI_ID)
  );
}

function isLegacyLlm(parsed: unknown): boolean {
  if (!isRecord(parsed) || !isRecord(parsed.llm)) {
    return false;
  }
  const llm = parsed.llm;
  if (isRecord(llm.providers) && Object.keys(llm.providers).length > 0) {
    return false;
  }
  return typeof llm.baseURL === "string" || typeof llm.model === "string";
}

function legacyProvider(llm: Record<string, unknown>): LlmProvider | undefined {
  const baseURL = typeof llm.baseURL === "string" ? llm.baseURL.trim().replace(/\/+$/, "") : "";
  const model = typeof llm.model === "string" ? llm.model.trim() : "";
  if (baseURL.length === 0 || model.length === 0) {
    return undefined;
  }
  const cliproxy = looksLikeCliproxy(baseURL);
  return {
    id: cliproxy ? CLIPROXYAPI_ID : "custom",
    displayName: cliproxy ? "CLIProxyAPI" : "Custom",
    baseURL,
    kind: cliproxy ? "shipped" : "custom",
    models: [model],
    thinking: {},
  };
}

function promoteCliproxy(providers: LlmProvider[]): LlmProvider[] {
  const hasOfficial = providers.some((item) => item.id === CLIPROXYAPI_ID);
  return providers.map((item) => {
    if (!hasOfficial && item.id !== CLIPROXYAPI_ID && looksLikeCliproxy(item.baseURL)) {
      return {
        ...item,
        id: CLIPROXYAPI_ID,
        displayName:
          item.displayName === "Custom" || item.displayName === item.id ? "CLIProxyAPI" : item.displayName,
        kind: "shipped",
      };
    }
    return { ...item, kind: isShippedId(item.id) ? "shipped" : "custom" };
  });
}

function parseProviders(raw: unknown): LlmProvider[] {
  if (!isRecord(raw)) {
    return [];
  }
  const out: LlmProvider[] = [];
  for (const [id, value] of Object.entries(raw)) {
    if (!PROVIDER_ID_RE.test(id) || !isRecord(value)) {
      continue;
    }
    const catalog = shippedProvider(id);
    const baseURL =
      typeof value.baseURL === "string" && value.baseURL.trim()
        ? value.baseURL.trim().replace(/\/+$/, "")
        : (catalog?.baseURL ?? "");
    if (baseURL.length === 0) {
      continue;
    }
    const parsed = parseModelList(value.models);
    out.push({
      id,
      displayName:
        typeof value.displayName === "string" && value.displayName.trim()
          ? value.displayName.trim()
          : (catalog?.displayName ?? id),
      baseURL,
      kind: isShippedId(id) ? "shipped" : "custom",
      models: parsed.models,
      thinking: parsed.thinking,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function parseModelList(raw: unknown): { models: string[]; thinking: Record<string, string[]> } {
  const models: string[] = [];
  const thinking: Record<string, string[]> = {};
  if (!Array.isArray(raw)) {
    return { models, thinking };
  }
  for (const item of raw) {
    if (typeof item === "string") {
      const id = item.trim();
      if (id.length > 0 && !models.includes(id)) {
        models.push(id);
      }
      continue;
    }
    if (!isRecord(item) || typeof item.id !== "string") {
      continue;
    }
    const id = item.id.trim();
    if (id.length === 0 || models.includes(id)) {
      continue;
    }
    models.push(id);
    const levels = sanitizeThinking(item.thinking);
    if (levels.length > 0) {
      thinking[id] = levels;
    }
  }
  return { models, thinking };
}

function uniqueModels(models: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of models) {
    const id = raw.trim();
    if (id.length === 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

function serializeConfig(config: AppConfig): string {
  const lines = [
    "llm:",
    `  activeProvider: ${config.llm.activeProvider ? yamlScalar(config.llm.activeProvider) : "null"}`,
    `  activeModel: ${config.llm.activeModel ? yamlScalar(config.llm.activeModel) : "null"}`,
    `  activeThinking: ${config.llm.activeThinking ? yamlScalar(config.llm.activeThinking) : "null"}`,
  ];
  if (config.llm.providers.length === 0) {
    lines.push("  providers: {}");
  } else {
    lines.push("  providers:");
    for (const provider of config.llm.providers) {
      lines.push(`    ${provider.id}:`);
      lines.push(`      displayName: ${yamlScalar(provider.displayName)}`);
      lines.push(`      baseURL: ${yamlScalar(provider.baseURL)}`);
      lines.push(`      kind: ${provider.kind}`);
      if (provider.models.length === 0) {
        lines.push("      models: []");
      } else {
        lines.push("      models:");
        for (const model of provider.models) {
          const levels = provider.thinking[model] ?? [];
          if (levels.length === 0) {
            lines.push(`        - ${yamlScalar(model)}`);
          } else {
            lines.push(`        - id: ${yamlScalar(model)}`);
            lines.push("          thinking:");
            for (const level of levels) {
              lines.push(`            - ${yamlScalar(level)}`);
            }
          }
        }
      }
    }
  }
  lines.push(
    "approval:",
    `  mode: ${config.approval.mode}`,
    "botMode:",
    `  protocol: ${config.botMode.protocol}`,
    "project:",
    `  current: ${config.project.current ? yamlScalar(config.project.current) : "null"}`,
  );
  if (config.project.recents.length === 0) {
    lines.push("  recents: []");
  } else {
    lines.push("  recents:", ...config.project.recents.map((item) => `    - ${yamlScalar(item)}`));
  }
  lines.push("");
  return lines.join("\n");
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
