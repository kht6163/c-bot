import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CONFIG,
  keyEnvName,
  loadConfig,
  projectName,
  rememberProject,
  forgetProject,
  removeProvider,
  saveConfig,
  upsertProvider,
} from "../src/config.ts";
import { applyEnvFile, loadSecrets, providerKey, saveProviderKey } from "../src/secrets.ts";

describe("config", () => {
  test("folds leftover baseURL and model into a custom provider", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-legacy-"));
    await Bun.write(
      join(home, "config.yaml"),
      [
        "llm:",
        '  baseURL: "https://gateway.example/v1"',
        '  model: "alpha"',
        "approval:",
        "  mode: prompt",
        "botMode:",
        "  protocol: true",
        "project:",
        "  current: null",
        "  recents: []",
        "",
      ].join("\n"),
    );
    const loaded = await loadConfig(home);
    expect(loaded.llm.providers).toEqual([
      {
        id: "custom",
        displayName: "Custom",
        baseURL: "https://gateway.example/v1",
        kind: "custom",
        models: ["alpha"],
        thinking: {},
      },
    ]);
    expect(loaded.llm.activeProvider).toBe("custom");
    expect(loaded.llm.activeModel).toBe("alpha");
    const yaml = await readFile(join(home, "config.yaml"), "utf8");
    expect(yaml).toContain("custom:");
    expect(yaml).not.toContain("baseURL: \"https://gateway.example/v1\"\n  model:");
  });

  test("starts with no providers", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-config-"));
    const first = await loadConfig(home);
    expect(first.llm.providers).toEqual([]);
    expect(first.llm.activeProvider).toBeNull();
    expect(first.llm.activeModel).toBeNull();
    expect(first.llm).not.toHaveProperty("baseURL");
  });

  test("round-trips a custom provider", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-prov-"));
    const first = await loadConfig(home);
    const next = upsertProvider(first, {
      id: "acme-gateway",
      displayName: "Acme",
      baseURL: "https://gateway.example/v1/",
      models: ["alpha", "beta", "alpha"],
    });
    await saveConfig(home, next);
    const yaml = await readFile(join(home, "config.yaml"), "utf8");
    expect(yaml).toContain("acme-gateway");
    expect(yaml).not.toContain("api.x.ai");
    const loaded = await loadConfig(home);
    expect(loaded.llm.activeProvider).toBe("acme-gateway");
    expect(loaded.llm.activeModel).toBe("alpha");
    expect(loaded.llm.providers).toEqual([
      {
        id: "acme-gateway",
        displayName: "Acme",
        baseURL: "https://gateway.example/v1",
        kind: "custom",
        models: ["alpha", "beta"],
        thinking: {},
      },
    ]);
  });

  test("removeProvider clears the active selection", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-rm-"));
    let config = await loadConfig(home);
    config = upsertProvider(config, {
      id: "one",
      displayName: "One",
      baseURL: "https://one.example/v1",
      models: ["m1"],
    });
    config = removeProvider(config, "one");
    expect(config.llm.providers).toEqual([]);
    expect(config.llm.activeProvider).toBeNull();
  });

  test("rememberProject stores current and recents", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-project-"));
    const first = await loadConfig(home);
    expect(first.project.current).toBeNull();
    const next = rememberProject(first, "/tmp/demo-app");
    await saveConfig(home, next);
    const loaded = await loadConfig(home);
    expect(loaded.project.current).toBe("/tmp/demo-app");
    expect(loaded.project.recents).toEqual(["/tmp/demo-app"]);
    expect(projectName(loaded.project.current)).toBe("demo-app");
  });

  test("rememberProject keeps added order when selecting an existing project", () => {
    let config = rememberProject(DEFAULT_CONFIG, "/tmp/one");
    config = rememberProject(config, "/tmp/two");
    config = rememberProject(config, "/tmp/one");
    expect(config.project.current).toBe("/tmp/one");
    expect(config.project.recents).toEqual(["/tmp/one", "/tmp/two"]);
  });

  test("forgetProject drops a recent and picks another current", () => {
    let config = rememberProject(DEFAULT_CONFIG, "/tmp/one");
    config = rememberProject(config, "/tmp/two");
    config = forgetProject(config, "/tmp/two");
    expect(config.project.current).toBe("/tmp/one");
    expect(config.project.recents).toEqual(["/tmp/one"]);
    config = forgetProject(config, "/tmp/one");
    expect(config.project.current).toBeNull();
    expect(config.project.recents).toEqual([]);
  });

  test("keyEnvName derives a credential reference", () => {
    expect(keyEnvName("acme-gateway")).toBe("ACME_GATEWAY_API_KEY");
    expect(DEFAULT_CONFIG.llm.providers).toEqual([]);
  });
});

describe("secrets", () => {
  test("process env wins over the home .env file", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-secrets-"));
    await saveProviderKey(home, "acme", "from-file");
    const secrets = await loadSecrets(home, { ACME_API_KEY: "from-process" });
    expect(providerKey(secrets, "acme")).toBe("from-process");
    const fileOnly = await loadSecrets(home, {});
    expect(providerKey(fileOnly, "acme")).toBe("from-file");
  });

  test("applyEnvFile fills only empty keys", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-envfile-"));
    const path = join(home, ".env");
    await Bun.write(path, "ACME_API_KEY=from-file\nCBOT_PORT=4090\n");
    const target: Record<string, string | undefined> = { ACME_API_KEY: "already", CBOT_PORT: "" };
    await applyEnvFile(path, target);
    expect(target.ACME_API_KEY).toBe("already");
    expect(target.CBOT_PORT).toBe("4090");
  });
});
