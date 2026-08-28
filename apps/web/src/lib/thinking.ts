import type { SettingsView } from "./api.ts";

export function shortModelName(modelId: string): string {
  return modelId.split("/").at(-1) || modelId;
}

export function leaderTurnLabel(
  leader: { model: string | null; thinking: string | null } | undefined,
  fallback: { activeModel: string | null; activeThinking: string | null } | undefined,
): string {
  const model = leader?.model || fallback?.activeModel;
  if (!model) {
    return "모델 없음";
  }
  const thinking = leader?.thinking || (leader?.model ? null : (fallback?.activeThinking ?? null));
  const name = shortModelName(model);
  return thinking ? `${name} · ${effortLabel(thinking)}` : name;
}

export function effortLabel(id: string): string {
  if (id === "xhigh") {
    return "Xhigh";
  }
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export function defaultEffort(levels: readonly string[]): string | null {
  for (const prefer of ["xhigh", "high", "medium", "low", "minimal", "max", "ultra"] as const) {
    if (levels.includes(prefer)) {
      return prefer;
    }
  }
  return levels.find((level) => level !== "off") ?? levels[0] ?? null;
}

export function effortsFor(
  settings: SettingsView | undefined,
  providerId: string | null,
  modelId: string | null,
): string[] {
  if (!settings || !providerId || !modelId) {
    return [];
  }
  const provider = settings.providers.find((item) => item.id === providerId);
  return provider?.thinking[modelId] ?? [];
}
