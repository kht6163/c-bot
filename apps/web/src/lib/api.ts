import type { HealthResponse, SessionEvent, SessionId, SessionSummary, ToolCallId } from "@cbot/shared";

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  if (!res.ok) {
    throw new Error(`health ${res.status}`);
  }
  return (await res.json()) as HealthResponse;
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  const res = await fetch("/api/sessions");
  if (!res.ok) {
    throw new Error(`sessions ${res.status}`);
  }
  const body = (await res.json()) as { sessions: SessionSummary[] };
  return body.sessions;
}

export async function createSession(): Promise<SessionSummary> {
  const res = await fetch("/api/sessions", { method: "POST", body: "{}" });
  if (!res.ok) {
    throw new Error(`create ${res.status}`);
  }
  const body = (await res.json()) as { session: SessionSummary };
  return body.session;
}

export async function fetchSession(
  id: SessionId,
): Promise<{ session: SessionSummary; events: SessionEvent[] }> {
  const res = await fetch(`/api/sessions/${id}`);
  if (!res.ok) {
    throw new Error(`session ${res.status}`);
  }
  return (await res.json()) as { session: SessionSummary; events: SessionEvent[] };
}

export async function sendMessage(id: SessionId, text: string): Promise<void> {
  const res = await fetch(`/api/sessions/${id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`send ${res.status}`);
  }
}

export interface SettingsView {
  model: string;
  baseURL: string;
  hasApiKey: boolean;
}

export async function fetchSettings(): Promise<SettingsView> {
  const res = await fetch("/api/settings");
  if (!res.ok) {
    throw new Error(`settings ${res.status}`);
  }
  return (await res.json()) as SettingsView;
}

export async function saveSettings(input: { model: string; baseURL: string }): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`settings ${res.status}`);
  }
}

export async function saveApiKey(xaiApiKey: string): Promise<void> {
  const res = await fetch("/api/secrets", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ xaiApiKey }),
  });
  if (!res.ok) {
    throw new Error(`secrets ${res.status}`);
  }
}

export async function setWorkspace(id: SessionId, workspace: string): Promise<SessionSummary> {
  const res = await fetch(`/api/sessions/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace }),
  });
  if (!res.ok) {
    throw new Error(`workspace ${res.status}`);
  }
  const body = (await res.json()) as { session: SessionSummary };
  return body.session;
}

export interface FsEntry {
  name: string;
  path: string;
  type: "dir" | "file";
}

export async function browseDir(path?: string): Promise<{
  path: string;
  parent: string | null;
  entries: FsEntry[];
}> {
  const q = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await fetch(`/api/fs/browse${q}`);
  if (!res.ok) {
    throw new Error(`browse ${res.status}`);
  }
  return (await res.json()) as { path: string; parent: string | null; entries: FsEntry[] };
}

export async function sendApproval(id: SessionId, callId: ToolCallId, allow: boolean): Promise<void> {
  const res = await fetch(`/api/sessions/${id}/approvals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callId, allow }),
  });
  if (!res.ok) {
    throw new Error(`approval ${res.status}`);
  }
}

export function openEvents(): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(`${proto}://${location.host}/ws`);
}
