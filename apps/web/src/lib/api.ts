import type {
  ApprovalRemember,
  BotToolName,
  GitDiffScope,
  GitDiffView,
  GitRepoInfo,
  HealthResponse,
  ProjectView,
  SessionEvent,
  SessionId,
  SessionListResponse,
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
  /** null is every tool. */
  tools: BotToolName[] | null;
  soul?: string;
  skills?: string[];
  /** Where the bot's skills folder is on disk. */
  skillsDir?: string;
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
  tools?: BotToolName[] | null;
  soul?: string;
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
    hidden?: boolean;
    tools?: BotToolName[] | null;
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
  cue: string;
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
  input: { title: string; cue: string; body: string },
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
  input: { title?: string; cue?: string; body?: string },
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

/** Also removes the worktrees of its sessions; refused with `worktree_dirty` while one holds work, unless forced. */
export async function deleteProject(path: string, options: { force?: boolean } = {}): Promise<ProjectView> {
  return api<ProjectView>("/api/project", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, ...(options.force ? { force: true } : {}) }),
  });
}

export async function fetchSessions(): Promise<SessionListResponse> {
  return api<SessionListResponse>("/api/sessions");
}

/**
 * An empty or absent title leaves the session to take its name from the first
 * message. `worktree` checks a new branch out into a folder of its own first.
 */
export async function createSession(
  workspace?: string,
  input: { title?: string; worktree?: { branch: string } } = {},
): Promise<SessionSummary> {
  const body = await api<{ session: SessionSummary }>("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...(workspace !== undefined ? { workspace } : {}), ...input }),
  });
  return body.session;
}

export async function renameSession(id: SessionId, title: string): Promise<SessionSummary> {
  const body = await api<{ session: SessionSummary }>(`/api/sessions/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
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

/** Also removes the session's worktree; refused with `worktree_dirty` while it holds work, unless forced. */
export async function deleteSession(id: SessionId, options: { force?: boolean } = {}): Promise<void> {
  await api<{ ok: boolean }>(`/api/sessions/${id}${options.force ? "?force=1" : ""}`, {
    method: "DELETE",
  });
}

export async function fetchRepoInfo(path: string): Promise<GitRepoInfo> {
  const body = await api<{ repo: GitRepoInfo }>(`/api/git/repo?path=${encodeURIComponent(path)}`);
  return body.repo;
}

export interface GitFileView {
  path: string;
  originalPath?: string;
  index: string;
  worktree: string;
  label: string;
}

export type GitRefKind = "local" | "remote" | "tag";

export interface GitRefView {
  name: string;
  kind: GitRefKind;
  head: boolean;
  sha: string;
  upstream: string | null;
}

export interface GitCommitView {
  sha: string;
  short: string;
  subject: string;
  author: string;
  date: string;
  refs: string[];
}

export interface GitCommitFileView {
  path: string;
  added: number | null;
  removed: number | null;
}

export interface GitCommitDetailView extends GitCommitView {
  email: string;
  body: string;
  files: GitCommitFileView[];
}

export interface GitStatusView {
  repo: boolean;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFileView[];
  refs: GitRefView[];
  commits: GitCommitView[];
}

export interface DirEntryView {
  name: string;
  path: string;
  kind: "file" | "dir";
}

export interface FilePreviewView {
  path: string;
  kind: "text" | "image" | "binary" | "missing";
  text: string;
  bytes: number;
}

export interface TaskView {
  id: string;
  boardId: string;
  parentId: string | null;
  title: string;
  detail: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  ownerId: string;
  ownerHandle: string;
  requesterId: string;
  requesterHandle: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchGitStatus(id: SessionId): Promise<GitStatusView> {
  const body = await api<{ git: GitStatusView }>(`/api/sessions/${id}/git`);
  return body.git;
}

export async function fetchGitDiff(id: SessionId, path: string, scope: GitDiffScope): Promise<GitDiffView> {
  const query = new URLSearchParams({ path, scope });
  const body = await api<{ diff: GitDiffView }>(`/api/sessions/${id}/git/diff?${query}`);
  return body.diff;
}

export interface SessionReviewView {
  files: { path: string; writes: number; edits: number }[];
  shellCommands: number;
}

export async function fetchSessionReview(id: SessionId): Promise<SessionReviewView> {
  const body = await api<{ review: SessionReviewView }>(`/api/sessions/${id}/git/review`);
  return body.review;
}

export async function fetchGitCommit(id: SessionId, sha: string): Promise<GitCommitDetailView> {
  const body = await api<{ commit: GitCommitDetailView }>(
    `/api/sessions/${id}/git/commit?sha=${encodeURIComponent(sha)}`,
  );
  return body.commit;
}

export async function fetchWorkspaceDir(id: SessionId, path = "."): Promise<DirEntryView[]> {
  const q = path && path !== "." ? `?path=${encodeURIComponent(path)}` : "";
  const body = await api<{ entries: DirEntryView[] }>(`/api/sessions/${id}/files${q}`);
  return body.entries;
}

export async function fetchWorkspaceFile(id: SessionId, path: string): Promise<FilePreviewView> {
  const body = await api<{ file: FilePreviewView }>(
    `/api/sessions/${id}/file?path=${encodeURIComponent(path)}`,
  );
  return body.file;
}

/** Where an image preview loads its bytes from. */
export function workspaceImageUrl(id: SessionId, path: string): string {
  return `/api/sessions/${id}/raw?path=${encodeURIComponent(path)}`;
}

export async function fetchTasks(id: SessionId): Promise<TaskView[]> {
  const body = await api<{ tasks: TaskView[] }>(`/api/sessions/${id}/tasks`);
  return body.tasks;
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
  /** `prompt` asks before risky tools; `allow` runs every tool without a card. */
  approvalMode: "prompt" | "allow";
  providers: ProviderView[];
  catalog: CatalogProviderView[];
}

export async function fetchSettings(): Promise<SettingsView> {
  return api<SettingsView>("/api/settings");
}

export async function saveApprovalMode(mode: "prompt" | "allow"): Promise<SettingsView> {
  return api<SettingsView>("/api/settings/approval", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
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

/** Stops the running turn. False when the turn had already ended. */
export async function interruptSession(id: SessionId): Promise<boolean> {
  const body = await api<{ ok: boolean; interrupted: boolean }>(`/api/sessions/${id}/interrupt`, {
    method: "POST",
  });
  return body.interrupted;
}

export async function sendApproval(
  id: SessionId,
  callId: ToolCallId,
  allow: boolean,
  remember?: ApprovalRemember,
): Promise<void> {
  await api<{ ok: boolean }>(`/api/sessions/${id}/approvals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callId, allow, ...(remember ? { remember } : {}) }),
  });
}

export function openEvents(): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(`${proto}://${location.host}/ws`);
}
