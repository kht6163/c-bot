import { chmod } from "node:fs/promises";
import { keyEnvName, secretsPath, type AppConfig } from "./config.ts";

export interface Secrets {
  keys: Record<string, string>;
}

export async function loadSecrets(
  home: string,
  processEnv: Record<string, string | undefined> = process.env,
): Promise<Secrets> {
  const fromFile = await readEnvFile(secretsPath(home));
  const keys: Record<string, string> = {};
  for (const [key, value] of Object.entries(fromFile)) {
    if (key.endsWith("_API_KEY") && value.trim()) {
      keys[key] = value.trim();
    }
  }
  for (const [key, value] of Object.entries(processEnv)) {
    if (key.endsWith("_API_KEY") && value && value.trim()) {
      keys[key] = value.trim();
    }
  }
  return { keys };
}

export function providerKey(secrets: Secrets, providerId: string): string | undefined {
  const name = keyEnvName(providerId);
  const value = secrets.keys[name];
  return value && value.trim() ? value.trim() : undefined;
}

export function resolveLlmEndpoint(
  config: AppConfig,
  secrets: Secrets,
  pin?: { provider?: string | null; model?: string | null },
): { baseURL: string; apiKey: string; model: string } | undefined {
  const providerId = pin?.provider || config.llm.activeProvider;
  const model = pin?.model || config.llm.activeModel;
  if (!providerId || !model) {
    return undefined;
  }
  const provider = config.llm.providers.find((item) => item.id === providerId);
  if (!provider) {
    return undefined;
  }
  const apiKey = providerKey(secrets, provider.id);
  if (!apiKey) {
    return undefined;
  }
  return { baseURL: provider.baseURL, apiKey, model };
}

/** Fill empty keys on `target` from a dotenv file. Existing non-empty values win. */
export async function applyEnvFile(
  path: string,
  target: Record<string, string | undefined> = process.env,
): Promise<void> {
  const values = await readEnvFile(path);
  for (const [key, value] of Object.entries(values)) {
    const current = target[key];
    if (!current || current.trim().length === 0) {
      target[key] = value;
    }
  }
}

export async function saveProviderKey(home: string, providerId: string, key: string): Promise<void> {
  const path = secretsPath(home);
  const current = await readEnvFile(path);
  const envName = keyEnvName(providerId);
  if (key.trim()) {
    current[envName] = key.trim();
  } else {
    delete current[envName];
  }
  const body = Object.entries(current)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")
    .concat("\n");
  await Bun.write(path, body);
  await chmod(path, 0o600);
}

async function readEnvFile(path: string): Promise<Record<string, string>> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return {};
  }
  const out: Record<string, string> = {};
  const text = await file.text();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
