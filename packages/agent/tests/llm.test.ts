import { describe, expect, test } from "bun:test";
import { LlmError, OpenAiCompatClient, probeLlm } from "../src/llm/client.ts";

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
      baseURL: "https://api.x.ai/v1",
      apiKey: "k",
      model: "grok-4.6",
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
        baseURL: "https://api.x.ai/v1",
        apiKey: "k",
        model: "grok-4.6",
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
      { baseURL: "https://api.x.ai/v1", apiKey: "", model: "grok-4.6" },
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
      { baseURL: "https://api.x.ai/v1", apiKey: "k", model: "grok-4.6" },
      async (url) => {
        expect(url).toBe("https://api.x.ai/v1/models");
        return new Response("{}", { status: 200 });
      },
    );
    expect(result.ok).toBe(true);
    expect(result.model).toBe("grok-4.6");
  });

  test("maps 401 from /models to provider_auth_or_access", async () => {
    const result = await probeLlm(
      { baseURL: "https://api.x.ai/v1", apiKey: "bad", model: "grok-4.6" },
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
