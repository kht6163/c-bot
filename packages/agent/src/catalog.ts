/** Shipped OpenAI-compatible providers, including CLIProxyAPI. */

export type ProviderKind = "shipped" | "custom";

export interface ShippedProvider {
  id: string;
  displayName: string;
  baseURL: string;
  /** Extra query for model listing (CLIProxyAPI thinking catalog). */
  modelsQuery?: string;
}

export const CLIPROXYAPI_ID = "cliproxyapi";

export const SHIPPED_PROVIDERS: readonly ShippedProvider[] = [
  {
    id: CLIPROXYAPI_ID,
    displayName: "CLIProxyAPI",
    baseURL: "http://127.0.0.1:8317/v1",
    modelsQuery: "client_version=pi",
  },
  { id: "openai", displayName: "OpenAI", baseURL: "https://api.openai.com/v1" },
  { id: "deepseek", displayName: "DeepSeek", baseURL: "https://api.deepseek.com" },
  { id: "openrouter", displayName: "OpenRouter", baseURL: "https://openrouter.ai/api/v1" },
  { id: "groq", displayName: "Groq", baseURL: "https://api.groq.com/openai/v1" },
  { id: "xai", displayName: "xAI", baseURL: "https://api.x.ai/v1" },
  { id: "mistral", displayName: "Mistral", baseURL: "https://api.mistral.ai/v1" },
  { id: "together", displayName: "Together", baseURL: "https://api.together.xyz/v1" },
  { id: "fireworks", displayName: "Fireworks", baseURL: "https://api.fireworks.ai/inference/v1" },
  { id: "cerebras", displayName: "Cerebras", baseURL: "https://api.cerebras.ai/v1" },
  { id: "nvidia", displayName: "NVIDIA", baseURL: "https://integrate.api.nvidia.com/v1" },
  { id: "huggingface", displayName: "Hugging Face", baseURL: "https://router.huggingface.co/v1" },
  { id: "moonshotai", displayName: "Moonshot", baseURL: "https://api.moonshot.ai/v1" },
  { id: "moonshotai-cn", displayName: "Moonshot CN", baseURL: "https://api.moonshot.cn/v1" },
  { id: "minimax", displayName: "MiniMax", baseURL: "https://api.minimax.io/v1" },
  { id: "minimax-cn", displayName: "MiniMax CN", baseURL: "https://api.minimaxi.com/v1" },
  { id: "google", displayName: "Google", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { id: "zai", displayName: "Z.AI", baseURL: "https://api.z.ai/api/paas/v4" },
  { id: "kimi-coding", displayName: "Kimi Coding", baseURL: "https://api.kimi.com/coding/v1" },
  { id: "vercel-ai-gateway", displayName: "Vercel AI Gateway", baseURL: "https://ai-gateway.vercel.sh/v1" },
];

const BY_ID = new Map(SHIPPED_PROVIDERS.map((item) => [item.id, item]));

export function shippedProvider(id: string): ShippedProvider | undefined {
  return BY_ID.get(id);
}

export function isShippedId(id: string): boolean {
  return BY_ID.has(id);
}

export function looksLikeCliproxy(baseURL: string): boolean {
  const url = baseURL.toLowerCase();
  return url.includes(":8317") || url.includes("cliproxy");
}

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const THINKING_ALIASES: Record<string, ThinkingLevel> = { none: "off" };

export function sanitizeThinking(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const allowed = new Set<string>(THINKING_LEVELS);
  const out: string[] = [];
  for (const item of raw) {
    const rawValue =
      typeof item === "string"
        ? item.trim().toLowerCase()
        : isRecord(item) && typeof item.effort === "string"
          ? item.effort.trim().toLowerCase()
          : "";
    const value = THINKING_ALIASES[rawValue] ?? rawValue;
    if (value.length > 0 && allowed.has(value) && !out.includes(value)) {
      out.push(value);
    }
  }
  return out;
}

export function defaultThinking(levels: readonly string[]): string | null {
  for (const prefer of ["xhigh", "high", "medium", "low", "minimal", "max", "ultra"] as const) {
    if (levels.includes(prefer)) {
      return prefer;
    }
  }
  return levels.find((level) => level !== "off") ?? levels[0] ?? null;
}

export function modelsQueryFor(providerId: string, baseURL: string): string | undefined {
  return shippedProvider(providerId)?.modelsQuery ?? (looksLikeCliproxy(baseURL) ? "client_version=pi" : undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
