import { describe, expect, test } from "bun:test";
import { defaultThinking, sanitizeThinking } from "../src/catalog.ts";
import {
  LlmError,
  OpenAiCompatClient,
  listRemoteModelCatalog,
  probeLlm,
  refreshProviderThinking,
} from "../src/llm/client.ts";
import { DEFAULT_CONFIG, type AppConfig } from "../src/config.ts";
import type { Secrets } from "../src/secrets.ts";

describe("OpenAiCompatClient", () => {
  test("parses SSE content deltas", async () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"He"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"y"}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const client = new OpenAiCompatClient(async () => new Response(body, { status: 200 }));
    const texts: string[] = [];
    for await (const event of client.stream({
      baseURL: "https://llm.example/v1",
      apiKey: "k",
      model: "demo",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (event.type === "text") {
        texts.push(event.text);
      }
    }
    expect(texts.join("")).toBe("Hey");
  });

  test("maps 401 to provider_auth_or_access", async () => {
    const client = new OpenAiCompatClient(async () => new Response("no", { status: 401 }));
    try {
      for await (const _ of client.stream({
        baseURL: "https://llm.example/v1",
        apiKey: "k",
        model: "demo",
        system: "sys",
        messages: [],
      })) {
        // drain
      }
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(LlmError);
      expect((err as LlmError).reason).toBe("provider_auth_or_access");
    }
  });
});

describe("probeLlm", () => {
  test("treats an empty key as missing_config without fetching", async () => {
    let called = false;
    const result = await probeLlm(
      { baseURL: "https://llm.example/v1", apiKey: "", model: "demo" },
      async () => {
        called = true;
        return new Response("no", { status: 500 });
      },
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_config");
  });

  test("succeeds when GET /models accepts the key", async () => {
    const result = await probeLlm(
      { baseURL: "https://llm.example/v1", apiKey: "k", model: "demo" },
      async (url) => {
        expect(url).toBe("https://llm.example/v1/models");
        return new Response("{}", { status: 200 });
      },
    );
    expect(result.ok).toBe(true);
    expect(result.model).toBe("demo");
  });

  test("maps 401 from /models to provider_auth_or_access", async () => {
    const result = await probeLlm(
      { baseURL: "https://llm.example/v1", apiKey: "bad", model: "demo" },
      async () => new Response("no", { status: 401 }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("provider_auth_or_access");
  });

  test("falls back to chat completions when /models is missing", async () => {
    const result = await probeLlm(
      { baseURL: "https://api.example.com/v1", apiKey: "k", model: "local" },
      async (url) => {
        if (String(url).endsWith("/models")) {
          return new Response("no", { status: 404 });
        }
        return new Response("{}", { status: 200 });
      },
    );
    expect(result.ok).toBe(true);
  });
});

describe("listRemoteModelCatalog", () => {
  test("reads CLIProxyAPI pi catalogs and maps none to off", async () => {
    const catalog = await listRemoteModelCatalog(
      { baseURL: "http://127.0.0.1:8317/v1", apiKey: "k", modelsQuery: "client_version=pi" },
      async (url) => {
        expect(String(url)).toBe("http://127.0.0.1:8317/v1/models?client_version=pi");
        return Response.json({
          models: [
            {
              slug: "grok-4.6",
              supported_reasoning_levels: [{ effort: "none" }, { effort: "low" }, "xhigh"],
            },
            { id: "hidden", visibility: "hide", supported_reasoning_levels: ["high"] },
          ],
        });
      },
    );
    expect(catalog).toEqual([
      { id: "grok-4.6", thinking: ["off", "low", "xhigh"] },
    ]);
  });

  test("still reads OpenAI data arrays", async () => {
    const catalog = await listRemoteModelCatalog(
      { baseURL: "https://api.openai.com/v1", apiKey: "k" },
      async () => Response.json({ data: [{ id: "gpt-4.1" }] }),
    );
    expect(catalog).toEqual([{ id: "gpt-4.1", thinking: [] }]);
  });
});

describe("sanitizeThinking", () => {
  test("prefers xhigh as the default effort", () => {
    expect(sanitizeThinking(["none", "High", { effort: "xhigh" }])).toEqual(["off", "high", "xhigh"]);
    expect(defaultThinking(["off", "low", "xhigh"])).toBe("xhigh");
  });
});

describe("refreshProviderThinking", () => {
  test("fills empty thinking from the pi catalog and picks a default", async () => {
    const config: AppConfig = {
      ...DEFAULT_CONFIG,
      llm: {
        activeProvider: "cliproxyapi",
        activeModel: "grok-4.6",
        activeThinking: null,
        providers: [
          {
            id: "cliproxyapi",
            displayName: "CLIProxyAPI",
            baseURL: "http://127.0.0.1:8317/v1",
            kind: "shipped",
            models: ["grok-4.6"],
            thinking: {},
          },
        ],
      },
    };
    const secrets: Secrets = { keys: { CLIPROXYAPI_API_KEY: "k" } };
    const next = await refreshProviderThinking(config, secrets, async () =>
      Response.json({
        models: [
          { slug: "grok-4.6", supported_reasoning_levels: ["low", "high", "xhigh"] },
        ],
      }),
    );
    expect(next.llm.providers[0]?.thinking["grok-4.6"]).toEqual(["low", "high", "xhigh"]);
    expect(next.llm.activeThinking).toBe("xhigh");
  });
});
