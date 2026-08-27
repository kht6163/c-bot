import { describe, expect, test } from "bun:test";
import { LlmError, OpenAiCompatClient } from "../src/llm/client.ts";

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
