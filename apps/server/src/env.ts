import { homedir } from "node:os";
import { join } from "node:path";

export interface ProcessEnv {
  host: string;
  port: number;
  home: string;
}

export function loadProcessEnv(
  source: Record<string, string | undefined> = process.env,
): ProcessEnv {
  const portRaw = source.CBOT_PORT ?? "3080";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`CBOT_PORT must be an integer 1–65535, got ${portRaw}`);
  }
  const host = source.CBOT_HOST?.trim() || "127.0.0.1";
  const homeRaw = source.CBOT_HOME?.trim();
  const home = homeRaw && homeRaw.length > 0 ? homeRaw : join(homedir(), ".c-bot");
  return { host, port, home };
}
