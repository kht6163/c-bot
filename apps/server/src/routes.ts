import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  SHIPPED_PROVIDERS,
  gitCommit,
  gitView,
  keyEnvName,
  listRemoteModelCatalog,
  listWorkspaceDir,
  loadConfig,
  loadSecrets,
  modelsQueryFor,
  probeLlm,
  projectName,
  providerKey,
  readWorkspacePreview,
  refreshProviderThinking,
  rememberProject,
  forgetProject,
  searchWorkspaceFiles,
  removeProvider,
  saveConfig,
  saveProviderKey,
  shippedProvider,
  upsertProvider,
  validateProviderId,
  type LlmProvider,
} from "@cbot/agent";
import type { ProjectView, SessionId, SessionTeamMember } from "@cbot/shared";
import { createBot, deleteBot, listBots, loadBot, MemoryStore, TaskStore, taskBoardId, updateBot } from "@cbot/bot";
import { asBotId, asSessionId, asToolCallId } from "@cbot/shared";
import { HttpError, isRecord, jsonError, readJson } from "./json.ts";
import { homedir } from "node:os";
import { pickNativeDirectory } from "./pick-dir.ts";
import { resolvePickedDirectory } from "./resolve-dir.ts";
import {
  acceptUserMessage,
  interruptSession,
  settleApproval,
  type Runtime,
} from "./runtime.ts";

export async function handleApi(req: Request, runtime: Runtime): Promise<Response> {
  const url = new URL(req.url);
  try {
    if (url.pathname === "/api/project" && req.method === "GET") {
      const config = await loadConfig(runtime.env.home);
      return Response.json(
        toProjectView(config.project.current, config.project.recents, runtime.launchDir),
      );
    }
    if (url.pathname === "/api/project" && req.method === "PUT") {
      const body = await readJson(req);
      if (!isRecord(body) || typeof body.path !== "string" || body.path.trim().length === 0) {
        throw new HttpError(400, "project required");
      }
      const path = resolve(body.path.trim());
      const info = await stat(path).catch(() => null);
      if (!info?.isDirectory()) {
        throw new HttpError(400, "project is not a directory");
      }
      const config = await loadConfig(runtime.env.home);
      await saveConfig(runtime.env.home, rememberProject(config, path));
      const updated = await loadConfig(runtime.env.home);
      return Response.json(
        toProjectView(updated.project.current, updated.project.recents, runtime.launchDir),
      );
    }
    if (url.pathname === "/api/project" && req.method === "DELETE") {
      const body = await readJson(req);
      if (!isRecord(body) || typeof body.path !== "string" || body.path.trim().length === 0) {
        throw new HttpError(400, "project required");
      }
      const path = resolve(body.path.trim());
      const config = await loadConfig(runtime.env.home);
      const sessions = runtime.store.list({ kind: "coding", workspace: path });
      const known =
        config.project.current === path ||
        config.project.recents.includes(path) ||
        sessions.length > 0;
      if (!known) {
        throw new HttpError(404, "unknown project");
      }
      await saveConfig(runtime.env.home, forgetProject(config, path));
      runtime.store.deleteCodingByWorkspace(path);
      const updated = await loadConfig(runtime.env.home);
      return Response.json(
        toProjectView(updated.project.current, updated.project.recents, runtime.launchDir),
      );
    }
    if (url.pathname === "/api/sessions" && req.method === "GET") {
      return Response.json({
        sessions: runtime.store.list({ kind: "coding" }),
      });
    }
    if (url.pathname === "/api/bots" && req.method === "GET") {
      const records = await listBots(runtime.env.home);
      const bots = [];
      for (const record of records) {
        const loaded = await loadBot(runtime.env.home, record.id);
        bots.push(loaded ?? record);
      }
      return Response.json({ bots });
    }
    if (url.pathname === "/api/bots" && req.method === "POST") {
      const body = await readJson(req);
      if (!isRecord(body) || typeof body.handle !== "string") {
        throw new HttpError(400, "handle required");
      }
      const config = await loadConfig(runtime.env.home);
      const bot = await createBot(runtime.env.home, runtime.store, {
        handle: body.handle,
        title: typeof body.title === "string" ? body.title : body.handle,
        description: typeof body.description === "string" ? body.description : "",
        ...(typeof body.soul === "string" ? { soul: body.soul } : {}),
        workspace: config.project.current,
        provider: typeof body.provider === "string" ? body.provider : null,
        model: typeof body.model === "string" ? body.model : null,
        thinking: typeof body.thinking === "string" ? body.thinking : null,
      });
      return Response.json({ bot }, { status: 201 });
    }
    const memListMatch = /^\/api\/bots\/([^/]+)\/memories$/.exec(url.pathname);
    if (memListMatch) {
      const botId = asBotId(decodeURIComponent(memListMatch[1] ?? ""));
      const bot = await loadBot(runtime.env.home, botId);
      if (!bot) {
        throw new HttpError(404, "unknown bot");
      }
      const memory = await MemoryStore.open(runtime.env.home, botId);
      try {
        if (req.method === "GET") {
          const q = url.searchParams.get("q") ?? "";
          const memories = q.trim() ? memory.search(q) : memory.list();
          return Response.json({ memories });
        }
        if (req.method === "POST") {
          const body = await readJson(req);
          if (!isRecord(body)) {
            throw new HttpError(400, "invalid JSON");
          }
          const entry = memory.create({
            title: typeof body.title === "string" ? body.title : "",
            cue: typeof body.cue === "string" ? body.cue : "",
            body: typeof body.body === "string" ? body.body : "",
          });
          return Response.json({ memory: entry }, { status: 201 });
        }
      } finally {
        memory.close();
      }
    }
    const memOneMatch = /^\/api\/bots\/([^/]+)\/memories\/([^/]+)$/.exec(url.pathname);
    if (memOneMatch) {
      const botId = asBotId(decodeURIComponent(memOneMatch[1] ?? ""));
      const memId = decodeURIComponent(memOneMatch[2] ?? "");
      const bot = await loadBot(runtime.env.home, botId);
      if (!bot) {
        throw new HttpError(404, "unknown bot");
      }
      const memory = await MemoryStore.open(runtime.env.home, botId);
      try {
        if (req.method === "PUT") {
          const body = await readJson(req);
          if (!isRecord(body)) {
            throw new HttpError(400, "invalid JSON");
          }
          const entry = memory.update(memId, {
            ...(typeof body.title === "string" ? { title: body.title } : {}),
            ...(typeof body.cue === "string" ? { cue: body.cue } : {}),
            ...(typeof body.body === "string" ? { body: body.body } : {}),
          });
          if (!entry) {
            throw new HttpError(404, "unknown memory");
          }
          return Response.json({ memory: entry });
        }
        if (req.method === "DELETE") {
          if (!memory.remove(memId)) {
            throw new HttpError(404, "unknown memory");
          }
          return Response.json({ ok: true });
        }
      } finally {
        memory.close();
      }
    }
    const botMatch = /^\/api\/bots\/([^/]+)$/.exec(url.pathname);
    if (botMatch && req.method === "PUT") {
      const id = asBotId(decodeURIComponent(botMatch[1] ?? ""));
      const body = await readJson(req);
      if (!isRecord(body)) {
        throw new HttpError(400, "invalid JSON");
      }
      const bot = await updateBot(runtime.env.home, id, {
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.description === "string" ? { description: body.description } : {}),
        ...(typeof body.soul === "string" ? { soul: body.soul } : {}),
        ...(body.provider === null || typeof body.provider === "string" ? { provider: body.provider } : {}),
        ...(body.model === null || typeof body.model === "string" ? { model: body.model } : {}),
        ...(body.thinking === null || typeof body.thinking === "string" ? { thinking: body.thinking } : {}),
      });
      if (!bot) {
        throw new HttpError(404, "unknown bot");
      }
      return Response.json({ bot });
    }
    if (botMatch && req.method === "DELETE") {
      const id = asBotId(decodeURIComponent(botMatch[1] ?? ""));
      try {
        const ok = await deleteBot(runtime.env.home, id);
        if (!ok) {
          throw new HttpError(404, "unknown bot");
        }
      } catch (err) {
        if (err instanceof Error && err.message === "leader cannot be deleted") {
          throw new HttpError(400, err.message);
        }
        throw err;
      }
      return Response.json({ ok: true });
    }
    if (url.pathname === "/api/sessions" && req.method === "POST") {
      const body = await readJson(req);
      const title = isRecord(body) && typeof body.title === "string" ? body.title : undefined;
      const requested =
        isRecord(body) && typeof body.workspace === "string" && body.workspace.trim().length > 0
          ? resolve(body.workspace.trim())
          : null;
      let workspace: string;
      if (requested) {
        const info = await stat(requested).catch(() => null);
        if (!info?.isDirectory()) {
          throw new HttpError(400, "workspace is not a directory");
        }
        const config = await loadConfig(runtime.env.home);
        await saveConfig(runtime.env.home, rememberProject(config, requested));
        workspace = requested;
      } else {
        const config = await loadConfig(runtime.env.home);
        if (!config.project.current) {
          throw new HttpError(400, "project required");
        }
        workspace = config.project.current;
      }
      const session = runtime.store.create({
        ...(title !== undefined ? { title } : {}),
        workspace,
      });
      return Response.json({ session }, { status: 201 });
    }
    if (url.pathname === "/api/fs/browse" && req.method === "GET") {
      return Response.json(await browseDir(url.searchParams.get("path"), runtime.launchDir));
    }
    if (url.pathname === "/api/fs/search" && req.method === "GET") {
      const config = await loadConfig(runtime.env.home);
      const requested = url.searchParams.get("workspace")?.trim() || config.project.current;
      if (!requested) {
        throw new HttpError(400, "project required");
      }
      const workspace = resolve(requested);
      const allowed = new Set(
        [config.project.current, ...config.project.recents, runtime.launchDir]
          .filter((item): item is string => typeof item === "string" && item.length > 0)
          .map((item) => resolve(item)),
      );
      if (!allowed.has(workspace)) {
        throw new HttpError(400, "workspace is not a known project");
      }
      const info = await stat(workspace).catch(() => null);
      if (!info?.isDirectory()) {
        throw new HttpError(400, "workspace is not a directory");
      }
      const files = await searchWorkspaceFiles(workspace, url.searchParams.get("q") ?? "");
      return Response.json({ files });
    }
    if (url.pathname === "/api/fs/pick-dir" && req.method === "POST") {
      try {
        const path = await pickNativeDirectory();
        if (!path) {
          return Response.json({ cancelled: true });
        }
        const info = await stat(path).catch(() => null);
        if (!info?.isDirectory()) {
          throw new HttpError(400, "project is not a directory");
        }
        return Response.json({ path });
      } catch (err) {
        if (err instanceof HttpError) {
          throw err;
        }
        const message = err instanceof Error ? err.message : "folder picker failed";
        if (message.includes("unavailable")) {
          throw new HttpError(501, message);
        }
        throw new HttpError(400, message);
      }
    }
    if (url.pathname === "/api/fs/resolve-dir" && req.method === "POST") {
      const body = await readJson(req);
      if (!isRecord(body) || typeof body.name !== "string") {
        throw new HttpError(400, "name required");
      }
      const children = Array.isArray(body.children)
        ? body.children.filter((item): item is string => typeof item === "string")
        : [];
      const config = await loadConfig(runtime.env.home);
      const roots = [
        config.project.current,
        ...config.project.recents,
        runtime.launchDir,
        homedir(),
      ].filter((item): item is string => typeof item === "string" && item.length > 0);
      const path = await resolvePickedDirectory({ name: body.name.trim(), children, roots });
      if (!path) {
        throw new HttpError(404, "folder not found");
      }
      return Response.json({ path });
    }
    const inspectGit = /^\/api\/sessions\/([^/]+)\/git$/.exec(url.pathname);
    if (inspectGit && req.method === "GET") {
      const id = asSessionId(decodeURIComponent(inspectGit[1] ?? ""));
      const workspace = sessionWorkspace(runtime, id);
      return Response.json({ git: await gitView(workspace) });
    }
    const inspectCommit = /^\/api\/sessions\/([^/]+)\/git\/commit$/.exec(url.pathname);
    if (inspectCommit && req.method === "GET") {
      const id = asSessionId(decodeURIComponent(inspectCommit[1] ?? ""));
      const workspace = sessionWorkspace(runtime, id);
      const commit = await gitCommit(workspace, url.searchParams.get("sha") ?? "");
      if (!commit) {
        throw new HttpError(404, "unknown commit");
      }
      return Response.json({ commit });
    }
    const inspectFiles = /^\/api\/sessions\/([^/]+)\/files$/.exec(url.pathname);
    if (inspectFiles && req.method === "GET") {
      const id = asSessionId(decodeURIComponent(inspectFiles[1] ?? ""));
      const workspace = sessionWorkspace(runtime, id);
      const rel = url.searchParams.get("path") ?? ".";
      return Response.json({ path: rel, entries: await listWorkspaceDir(workspace, rel) });
    }
    const inspectFile = /^\/api\/sessions\/([^/]+)\/file$/.exec(url.pathname);
    if (inspectFile && req.method === "GET") {
      const id = asSessionId(decodeURIComponent(inspectFile[1] ?? ""));
      const workspace = sessionWorkspace(runtime, id);
      const rel = url.searchParams.get("path") ?? "";
      if (rel.trim().length === 0) {
        throw new HttpError(400, "path required");
      }
      return Response.json({ file: await readWorkspacePreview(workspace, rel) });
    }
    const tasksMatch = /^\/api\/sessions\/([^/]+)\/tasks$/.exec(url.pathname);
    if (tasksMatch && req.method === "GET") {
      const id = asSessionId(decodeURIComponent(tasksMatch[1] ?? ""));
      if (!runtime.store.get(id)) {
        throw new HttpError(404, "unknown session");
      }
      const boardId = taskBoardId(runtime.store, id);
      const tasks = await TaskStore.open(runtime.env.home);
      try {
        return Response.json({ tasks: tasks.list(boardId) });
      } finally {
        tasks.close();
      }
    }
    const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
    if (sessionMatch && req.method === "PUT") {
      const id = asSessionId(decodeURIComponent(sessionMatch[1] ?? ""));
      const session = runtime.store.get(id);
      if (!session) {
        throw new HttpError(404, "unknown session");
      }
      const body = await readJson(req);
      if (!isRecord(body) || typeof body.workspace !== "string" || body.workspace.trim().length === 0) {
        throw new HttpError(400, "workspace required");
      }
      const workspace = resolve(body.workspace.trim());
      const info = await stat(workspace).catch(() => null);
      if (!info?.isDirectory()) {
        throw new HttpError(400, "workspace is not a directory");
      }
      runtime.store.setWorkspace(id, workspace);
      const updated = runtime.store.get(id);
      return Response.json({ session: updated });
    }
    if (sessionMatch && req.method === "GET") {
      const id = asSessionId(decodeURIComponent(sessionMatch[1] ?? ""));
      const session = runtime.store.get(id);
      if (!session) {
        throw new HttpError(404, "unknown session");
      }
      return Response.json({
        session,
        events: runtime.store.events(id),
        team: await sessionTeam(runtime, id, session.kind),
      });
    }
    if (sessionMatch && req.method === "DELETE") {
      const id = asSessionId(decodeURIComponent(sessionMatch[1] ?? ""));
      const session = runtime.store.get(id);
      if (!session) {
        throw new HttpError(404, "unknown session");
      }
      if (session.kind === "bot-chat") {
        throw new HttpError(400, "bot chat cannot be deleted");
      }
      runtime.store.delete(id);
      return Response.json({ ok: true });
    }
    const approveMatch = /^\/api\/sessions\/([^/]+)\/approvals$/.exec(url.pathname);
    if (approveMatch && req.method === "POST") {
      const body = await readJson(req);
      if (!isRecord(body) || typeof body.callId !== "string" || typeof body.allow !== "boolean") {
        throw new HttpError(400, "callId and allow required");
      }
      const ok = settleApproval(runtime, asToolCallId(body.callId), body.allow);
      if (!ok) {
        throw new HttpError(404, "unknown approval");
      }
      return Response.json({ ok: true });
    }
    const interruptMatch = /^\/api\/sessions\/([^/]+)\/interrupt$/.exec(url.pathname);
    if (interruptMatch && req.method === "POST") {
      const id = asSessionId(decodeURIComponent(interruptMatch[1] ?? ""));
      if (!runtime.store.get(id)) {
        throw new HttpError(404, "unknown session");
      }
      return Response.json({ ok: true, interrupted: interruptSession(id) });
    }
    const messageMatch = /^\/api\/sessions\/([^/]+)\/messages$/.exec(url.pathname);
    if (messageMatch && req.method === "POST") {
      const id = asSessionId(decodeURIComponent(messageMatch[1] ?? ""));
      const body = await readJson(req);
      const text = isRecord(body) && typeof body.text === "string" ? body.text : "";
      await acceptUserMessage(runtime, id, text);
      return Response.json({ ok: true }, { status: 202 });
    }
    if (url.pathname === "/api/settings" && req.method === "GET") {
      const config = await loadConfig(runtime.env.home);
      const secrets = await loadSecrets(runtime.env.home);
      const refreshed = await refreshProviderThinking(config, secrets);
      if (refreshed !== config) {
        await saveConfig(runtime.env.home, refreshed);
      }
      return Response.json(toSettingsView(refreshed, secrets));
    }
    if (url.pathname === "/api/settings/active" && req.method === "PUT") {
      const body = await readJson(req);
      if (!isRecord(body)) {
        throw new HttpError(400, "invalid JSON");
      }
      const config = await loadConfig(runtime.env.home);
      const activeProvider =
        typeof body.provider === "string" && body.provider.trim() ? body.provider.trim() : null;
      const activeModel = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;
      const activeThinking =
        typeof body.thinking === "string" && body.thinking.trim() ? body.thinking.trim() : null;
      if (activeProvider && !config.llm.providers.some((item) => item.id === activeProvider)) {
        throw new HttpError(400, "unknown provider");
      }
      await saveConfig(runtime.env.home, {
        ...config,
        llm: { ...config.llm, activeProvider, activeModel, activeThinking },
      });
      const secrets = await loadSecrets(runtime.env.home);
      return Response.json(toSettingsView(await loadConfig(runtime.env.home), secrets));
    }
    if (url.pathname === "/api/providers" && req.method === "POST") {
      const body = await readJson(req);
      if (!isRecord(body)) {
        throw new HttpError(400, "invalid JSON");
      }
      let id: string;
      try {
        id = validateProviderId(typeof body.id === "string" ? body.id : "");
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : "invalid provider id");
      }
      const config = await loadConfig(runtime.env.home);
      if (config.llm.providers.some((item) => item.id === id)) {
        throw new HttpError(409, "provider exists");
      }
      const provider = providerFromBody(id, body);
      if (provider.baseURL.length === 0) {
        throw new HttpError(400, "baseURL required");
      }
      if (provider.models.length === 0) {
        throw new HttpError(400, "at least one model required");
      }
      await saveConfig(runtime.env.home, upsertProvider(config, provider));
      if (typeof body.apiKey === "string" && body.apiKey.trim()) {
        await saveProviderKey(runtime.env.home, id, body.apiKey.trim());
      }
      const secrets = await loadSecrets(runtime.env.home);
      return Response.json(toSettingsView(await loadConfig(runtime.env.home), secrets), { status: 201 });
    }
    const providerMatch = /^\/api\/providers\/([^/]+)$/.exec(url.pathname);
    if (providerMatch && req.method === "PUT") {
      const id = decodeURIComponent(providerMatch[1] ?? "");
      const body = await readJson(req);
      if (!isRecord(body)) {
        throw new HttpError(400, "invalid JSON");
      }
      const config = await loadConfig(runtime.env.home);
      const existing = config.llm.providers.find((item) => item.id === id);
      if (!existing) {
        throw new HttpError(404, "unknown provider");
      }
      const provider = providerFromBody(id, body, existing);
      if (provider.baseURL.length === 0) {
        throw new HttpError(400, "baseURL required");
      }
      if (provider.models.length === 0) {
        throw new HttpError(400, "at least one model required");
      }
      await saveConfig(runtime.env.home, upsertProvider(config, provider));
      if (typeof body.apiKey === "string") {
        await saveProviderKey(runtime.env.home, id, body.apiKey.trim());
      }
      const secrets = await loadSecrets(runtime.env.home);
      return Response.json(toSettingsView(await loadConfig(runtime.env.home), secrets));
    }
    if (providerMatch && req.method === "DELETE") {
      const id = decodeURIComponent(providerMatch[1] ?? "");
      const config = await loadConfig(runtime.env.home);
      if (!config.llm.providers.some((item) => item.id === id)) {
        throw new HttpError(404, "unknown provider");
      }
      await saveProviderKey(runtime.env.home, id, "");
      await saveConfig(runtime.env.home, removeProvider(config, id));
      const secrets = await loadSecrets(runtime.env.home);
      return Response.json(toSettingsView(await loadConfig(runtime.env.home), secrets));
    }
    if (url.pathname === "/api/llm/models" && req.method === "POST") {
      const body = await readJson(req);
      const fromBody = isRecord(body) ? body : {};
      const target = await resolveProbeTarget(runtime.env.home, fromBody);
      try {
        const query = modelsQueryFor(target.providerId, target.baseURL);
        const models = await listRemoteModelCatalog({
          baseURL: target.baseURL,
          apiKey: target.apiKey,
          ...(query ? { modelsQuery: query } : {}),
        });
        return Response.json({ models: models.map((item) => item.id), catalog: models });
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : "list models failed");
      }
    }
    if (url.pathname === "/api/llm/test" && req.method === "POST") {
      const body = await readJson(req);
      const fromBody = isRecord(body) ? body : {};
      const target = await resolveProbeTarget(runtime.env.home, fromBody);
      const result = await probeLlm({
        apiKey: target.apiKey,
        model: target.model,
        baseURL: target.baseURL,
      });
      return Response.json(result);
    }
    return Response.json({ error: "not found" }, { status: 404 });
  } catch (err) {
    return jsonError(err);
  }
}

function toSettingsView(
  config: Awaited<ReturnType<typeof loadConfig>>,
  secrets: Awaited<ReturnType<typeof loadSecrets>>,
) {
  const added = new Set(config.llm.providers.map((item) => item.id));
  const providers = config.llm.providers.map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    baseURL: provider.baseURL,
    kind: provider.kind,
    models: provider.models,
    thinking: provider.thinking,
    hasApiKey: Boolean(providerKey(secrets, provider.id)),
    keyEnv: keyEnvName(provider.id),
  }));
  return {
    activeProvider: config.llm.activeProvider,
    activeModel: config.llm.activeModel,
    activeThinking: config.llm.activeThinking,
    hasApiKey: providers.some((item) => item.hasApiKey),
    providers,
    catalog: SHIPPED_PROVIDERS.filter((item) => !added.has(item.id)),
  };
}

function providerFromBody(id: string, body: Record<string, unknown>, existing?: LlmProvider): LlmProvider {
  const catalog = shippedProvider(id);
  const models = Array.isArray(body.models)
    ? body.models.filter((item): item is string => typeof item === "string")
    : (existing?.models ?? []);
  const thinking = isRecord(body.thinking)
    ? Object.fromEntries(
        Object.entries(body.thinking).filter(
          (entry): entry is [string, string[]] => Array.isArray(entry[1]),
        ),
      )
    : (existing?.thinking ?? {});
  return {
    id,
    displayName:
      typeof body.displayName === "string" && body.displayName.trim()
        ? body.displayName.trim()
        : (existing?.displayName ?? catalog?.displayName ?? id),
    baseURL:
      typeof body.baseURL === "string" && body.baseURL.trim()
        ? body.baseURL.trim()
        : (existing?.baseURL ?? catalog?.baseURL ?? ""),
    kind: existing?.kind ?? (catalog ? "shipped" : "custom"),
    models,
    thinking,
  };
}

async function resolveProbeTarget(
  home: string,
  body: Record<string, unknown>,
): Promise<{ baseURL: string; apiKey: string; model: string; providerId: string }> {
  const config = await loadConfig(home);
  const secrets = await loadSecrets(home);
  const providerId = typeof body.provider === "string" ? body.provider.trim() : "";
  const provider = providerId ? config.llm.providers.find((item) => item.id === providerId) : undefined;
  const baseURL =
    typeof body.baseURL === "string" && body.baseURL.trim()
      ? body.baseURL.trim()
      : (provider?.baseURL ?? "");
  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : (provider?.models[0] ?? config.llm.activeModel ?? "");
  const apiKey =
    typeof body.apiKey === "string"
      ? body.apiKey.trim()
      : provider
        ? (providerKey(secrets, provider.id) ?? "")
        : "";
  return { baseURL, apiKey, model, providerId };
}

function sessionWorkspace(runtime: Runtime, id: SessionId): string {
  const session = runtime.store.get(id);
  if (!session) {
    throw new HttpError(404, "unknown session");
  }
  const board = session.parentId ? (runtime.store.get(session.parentId) ?? session) : session;
  const workspace = board.workspace ?? session.workspace;
  if (!workspace) {
    throw new HttpError(400, "workspace required");
  }
  return workspace;
}

async function sessionTeam(
  runtime: Runtime,
  id: SessionId,
  kind: string,
): Promise<SessionTeamMember[]> {
  if (kind !== "coding") {
    return [];
  }
  const hops = runtime.store.list({ kind: "bot-chat", parentId: id });
  const bots = await listBots(runtime.env.home);
  const team: SessionTeamMember[] = [];
  for (const hop of hops) {
    const bot = bots.find((item) => item.id === hop.botId);
    if (!bot || bot.role === "leader") {
      continue;
    }
    team.push({
      id: bot.id,
      handle: bot.handle,
      title: bot.title,
      role: bot.role,
      sessionId: hop.id,
    });
  }
  return team;
}

function toProjectView(current: string | null, recents: string[], launchDir: string): ProjectView {
  return {
    current,
    recents,
    name: projectName(current),
    launchDir,
    launchName: projectName(launchDir),
  };
}

async function browseDir(
  raw: string | null,
  fallback: string,
): Promise<{
  path: string;
  parent: string | null;
  entries: { name: string; path: string; type: "dir" | "file" }[];
}> {
  const path = resolve(raw && raw.trim().length > 0 ? raw : fallback);
  const info = await stat(path).catch(() => null);
  if (!info?.isDirectory()) {
    throw new HttpError(400, "not a directory");
  }
  const names = (await readdir(path)).sort((a, b) => a.localeCompare(b)).slice(0, 400);
  const entries = [];
  for (const name of names) {
    if (name.startsWith(".")) {
      continue;
    }
    const child = join(path, name);
    const childInfo = await stat(child).catch(() => null);
    if (!childInfo) {
      continue;
    }
    entries.push({
      name,
      path: child,
      type: childInfo.isDirectory() ? ("dir" as const) : ("file" as const),
    });
  }
  const parent = dirname(path);
  return { path, parent: parent === path ? null : parent, entries };
}
