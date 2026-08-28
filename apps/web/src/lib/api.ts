import type {
  HealthResponse,
  ProjectView,
  SessionEvent,
  SessionId,
  SessionSummary,
  SessionTeamMember,
  ToolCallId,
} from "@cbot/shared";
import { parseApiBody } from "./api-json.ts";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  return parseApiBody<T>(await res.text(), res.status, path);
}

export async function fetchHealth(): Promise<HealthResponse> {
  return api<HealthResponse>("/api/health");
}

export interface BotView {
  id: string;
  handle: string;
  title: string;
  description: string;
  role: "leader" | "specialist";
  provider: string | null;
  model: string | null;
  thinking: string | null;
  sessionId: string;
  hidden: boolean;
  soul?: string;
}

export async function fetchBots(): Promise<BotView[]> {
  const body = await api<{ bots: BotView[] }>("/api/bots");
  return body.bots;
}

export async function createBot(input: {
  handle: string;
  title: string;
  description: string;
  provider?: string | null;
  model?: string | null;
  thinking?: string | null;
}): Promise<BotView> {
  const body = await api<{ bot: BotView }>("/api/bots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return body.bot;
}

export async function updateBot(
  id: string,
  input: {
    title?: string;
    description?: string;
    soul?: string;
    provider?: string | null;
    model?: string | null;
    thinking?: string | null;
  },
): Promise<BotView> {
  const body = await api<{ bot: BotView }>(`/api/bots/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return body.bot;
}

export async function deleteBot(id: string): Promise<void> {
  await api<{ ok: boolean }>(`/api/bots/${id}`, { method: "DELETE" });
}

export interface MemoryView {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchMemories(botId: string, query = ""): Promise<MemoryView[]> {
  const path = query.trim()
    ? `/api/bots/${botId}/memories?q=${encodeURIComponent(query.trim())}`
    : `/api/bots/${botId}/memories`;
  const body = await api<{ memories: MemoryView[] }>(path);
  return body.memories;
}

export async function createMemory(
  botId: string,
  input: { title: string; body: string },
): Promise<MemoryView> {
  const body = await api<{ memory: MemoryView }>(`/api/bots/${botId}/memories`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return body.memory;
}

export async function updateMemory(
  botId: string,
  id: string,
  input: { title?: string; body?: string },
): Promise<MemoryView> {
  const body = await api<{ memory: MemoryView }>(`/api/bots/${botId}/memories/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return body.memory;
}

export async function deleteMemory(botId: string, id: string): Promise<void> {
  await api<{ ok: boolean }>(`/api/bots/${botId}/memories/${id}`, { method: "DELETE" });
}

export async function fetchProject(): Promise<ProjectView> {
  return api<ProjectView>("/api/project");
}

export async function openProject(path: string): Promise<ProjectView> {
  return api<ProjectView>("/api/project", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export async function deleteProject(path: string): Promise<ProjectView> {
  return api<ProjectView>("/api/project", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  const body = await api<{ sessions: SessionSummary[] }>("/api/sessions");
  return body.sessions;
}

export async function createSession(workspace?: string): Promise<SessionSummary> {
  const body = await api<{ session: SessionSummary }>("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(workspace !== undefined ? { workspace } : {}),
  });
  return body.session;
}

export async function fetchSession(
  id: SessionId,
): Promise<{ session: SessionSummary; events: SessionEvent[]; team: SessionTeamMember[] }> {
  const body = await api<{
    session: SessionSummary;
    events: SessionEvent[];
    team?: SessionTeamMember[];
  }>(`/api/sessions/${id}`);
  return { session: body.session, events: body.events, team: body.team ?? [] };
}

export async function deleteSession(id: SessionId): Promise<void> {
  await api<{ ok: boolean }>(`/api/sessions/${id}`, { method: "DELETE" });
}

export async function sendMessage(id: SessionId, text: string): Promise<void> {
  await api<{ ok: boolean }>(`/api/sessions/${id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export interface ProviderView {
  id: string;
  displayName: string;
  baseURL: string;
  kind: "shipped" | "custom";
  models: string[];
  thinking: Record<string, string[]>;
  hasApiKey: boolean;
  keyEnv: string;
}

export interface CatalogProviderView {
  id: string;
  displayName: string;
  baseURL: string;
}

export interface SettingsView {
  activeProvider: string | null;
  activeModel: string | null;
  activeThinking: string | null;
  hasApiKey: boolean;
  providers: ProviderView[];
  catalog: CatalogProviderView[];
}

export async function fetchSettings(): Promise<SettingsView> {
  return api<SettingsView>("/api/settings");
}

export async function saveActiveModel(input: {
  provider: string | null;
  model: string | null;
  thinking?: string | null;
}): Promise<SettingsView> {
  return api<SettingsView>("/api/settings/active", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function createProvider(input: {
  id: string;
  displayName: string;
  baseURL: string;
  models: string[];
  thinking?: Record<string, string[]>;
  apiKey?: string;
}): Promise<SettingsView> {
  return api<SettingsView>("/api/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateProvider(
  id: string,
  input: {
    displayName?: string;
    baseURL?: string;
    models?: string[];
    thinking?: Record<string, string[]>;
    apiKey?: string;
  },
): Promise<SettingsView> {
  return api<SettingsView>(`/api/providers/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteProvider(id: string): Promise<SettingsView> {
  return api<SettingsView>(`/api/providers/${id}`, { method: "DELETE" });
}

export interface LlmProbeView {
  ok: boolean;
  message: string;
  model: string;
  reason?: string;
}

export async function testLlmConnection(input: {
  provider?: string;
  apiKey?: string;
  model: string;
  baseURL: string;
}): Promise<LlmProbeView> {
  return api<LlmProbeView>("/api/llm/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function fetchRemoteModels(input: {
  provider?: string;
  baseURL: string;
  apiKey?: string;
}): Promise<{ models: string[]; catalog: { id: string; thinking: string[] }[] }> {
  return api<{ models: string[]; catalog: { id: string; thinking: string[] }[] }>("/api/llm/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function setWorkspace(id: SessionId, workspace: string): Promise<SessionSummary> {
  const body = await api<{ session: SessionSummary }>(`/api/sessions/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace }),
  });
  return body.session;
}

export interface FsEntry {
  name: string;
  path: string;
  type: "dir" | "file";
}

export async function pickNativeFolder(): Promise<{ path: string } | { cancelled: true }> {
  const body = await api<{ path: string | null; cancelled?: boolean }>("/api/fs/pick-dir", {
    method: "POST",
  });
  if (body.cancelled === true || typeof body.path !== "string" || body.path.length === 0) {
    return { cancelled: true };
  }
  return { path: body.path };
}

export async function resolvePickedDir(name: string, children: string[]): Promise<string> {
  const body = await api<{ path: string }>("/api/fs/resolve-dir", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, children }),
  });
  return body.path;
}

export async function searchProjectFiles(workspace: string, query: string): Promise<string[]> {
  const q = `?workspace=${encodeURIComponent(workspace)}&q=${encodeURIComponent(query)}`;
  const body = await api<{ files: string[] }>(`/api/fs/search${q}`);
  return body.files;
}

export async function browseDir(path?: string): Promise<{
  path: string;
  parent: string | null;
  entries: FsEntry[];
}> {
  const q = path ? `?path=${encodeURIComponent(path)}` : "";
  return api<{ path: string; parent: string | null; entries: FsEntry[] }>(`/api/fs/browse${q}`);
}

export async function sendApproval(id: SessionId, callId: ToolCallId, allow: boolean): Promise<void> {
  await api<{ ok: boolean }>(`/api/sessions/${id}/approvals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callId, allow }),
  });
}

export function openEvents(): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(`${proto}://${location.host}/ws`);
}
