import type {
  HealthResponse,
  ProjectView,
  SessionEvent,
  SessionId,
  SessionSummary,
  ToolCallId,
} from "@cbot/shared";

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  if (!res.ok) {
    throw new Error(`health ${res.status}`);
  }
  return (await res.json()) as HealthResponse;
}

export interface BotView {
  id: string;
  handle: string;
  title: string;
  description: string;
  sessionId: string;
  hidden: boolean;
}

export async function fetchBots(): Promise<BotView[]> {
  const res = await fetch("/api/bots");
  if (!res.ok) {
    throw new Error(`bots ${res.status}`);
  }
  const body = (await res.json()) as { bots: BotView[] };
  return body.bots;
}

export async function createBot(input: {
  handle: string;
  title: string;
  description: string;
}): Promise<BotView> {
  const res = await fetch("/api/bots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`create bot ${res.status}`);
  }
  const body = (await res.json()) as { bot: BotView };
  return body.bot;
}

export async function fetchProject(): Promise<ProjectView> {
  const res = await fetch("/api/project");
  if (!res.ok) {
    throw new Error(`project ${res.status}`);
  }
  return (await res.json()) as ProjectView;
}

export async function openProject(path: string): Promise<ProjectView> {
  const res = await fetch("/api/project", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    throw new Error(`project ${res.status}`);
  }
  return (await res.json()) as ProjectView;
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  const res = await fetch("/api/sessions");
  if (!res.ok) {
    throw new Error(`sessions ${res.status}`);
  }
  const body = (await res.json()) as { sessions: SessionSummary[] };
  return body.sessions;
}

export async function createSession(workspace?: string): Promise<SessionSummary> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(workspace !== undefined ? { workspace } : {}),
  });
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

export interface LlmProbeView {
  ok: boolean;
  message: string;
  model: string;
  reason?: string;
}

export async function testLlmConnection(input: {
  apiKey?: string;
  model: string;
  baseURL: string;
}): Promise<LlmProbeView> {
  const res = await fetch("/api/llm/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`llm test ${res.status}`);
  }
  return (await res.json()) as LlmProbeView;
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
