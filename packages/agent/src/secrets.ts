import { chmod } from "node:fs/promises";
import { secretsPath } from "./config.ts";

export interface Secrets {
  xaiApiKey: string | undefined;
}

export async function loadSecrets(
  home: string,
  processEnv: Record<string, string | undefined> = process.env,
): Promise<Secrets> {
  const fromFile = await readEnvFile(secretsPath(home));
  const xaiApiKey = firstNonEmpty(processEnv.XAI_API_KEY, fromFile.XAI_API_KEY);
  return { xaiApiKey };
}

export async function saveXaiApiKey(home: string, key: string): Promise<void> {
  const path = secretsPath(home);
  const current = await readEnvFile(path);
  current.XAI_API_KEY = key;
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

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}
