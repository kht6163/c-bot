import type { HealthResponse } from "@cbot/shared";

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  if (!res.ok) {
    throw new Error(`health ${res.status}`);
  }
  return (await res.json()) as HealthResponse;
}

export function openEvents(): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(`${proto}://${location.host}/ws`);
}
