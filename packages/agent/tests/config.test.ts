import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, loadConfig, saveConfig } from "../src/config.ts";
import { loadSecrets, saveXaiApiKey } from "../src/secrets.ts";

describe("config", () => {
  test("writes defaults then round-trips a model change", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-config-"));
    const first = await loadConfig(home);
    expect(first.llm.model).toBe(DEFAULT_CONFIG.llm.model);
    expect(first.llm.baseURL).toBe("https://api.x.ai/v1");
    await saveConfig(home, { ...first, llm: { ...first.llm, model: "grok-4.6" } });
    const yaml = await readFile(join(home, "config.yaml"), "utf8");
    expect(yaml).toContain("grok-4.6");
    const loaded = await loadConfig(home);
    expect(loaded.llm.model).toBe("grok-4.6");
  });
});

describe("secrets", () => {
  test("process env wins over the home .env file", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-secrets-"));
    await saveXaiApiKey(home, "from-file");
    const secrets = await loadSecrets(home, { XAI_API_KEY: "from-process" });
    expect(secrets.xaiApiKey).toBe("from-process");
    const fileOnly = await loadSecrets(home, {});
    expect(fileOnly.xaiApiKey).toBe("from-file");
  });
});
