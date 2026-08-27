import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  loadConfig,
  loadSecrets,
  probeLlm,
  projectName,
  rememberProject,
  saveConfig,
  saveXaiApiKey,
} from "@cbot/agent";
import type { ProjectView } from "@cbot/shared";
import { createBot, listBots } from "@cbot/bot";
import { asSessionId, asToolCallId } from "@cbot/shared";
import { HttpError, isRecord, jsonError, readJson } from "./json.ts";
import { acceptUserMessage, settleApproval, type Runtime } from "./runtime.ts";

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
    if (url.pathname === "/api/sessions" && req.method === "GET") {
      return Response.json({
        sessions: runtime.store.list({ kind: "coding" }),
      });
    }
    if (url.pathname === "/api/bots" && req.method === "GET") {
      return Response.json({ bots: await listBots(runtime.env.home) });
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
      });
      return Response.json({ bot }, { status: 201 });
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
      return Response.json({ session, events: runtime.store.events(id) });
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
      return Response.json({
        model: config.llm.model,
        baseURL: config.llm.baseURL,
        hasApiKey: Boolean(secrets.xaiApiKey),
      });
    }
    if (url.pathname === "/api/settings" && req.method === "PUT") {
      const body = await readJson(req);
      if (!isRecord(body)) {
        throw new HttpError(400, "invalid JSON");
      }
      const config = await loadConfig(runtime.env.home);
      const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : config.llm.model;
      const baseURL =
        typeof body.baseURL === "string" && body.baseURL.trim() ? body.baseURL.trim() : config.llm.baseURL;
      await saveConfig(runtime.env.home, { ...config, llm: { model, baseURL } });
      return Response.json({ model, baseURL });
    }
    if (url.pathname === "/api/llm/test" && req.method === "POST") {
      const body = await readJson(req);
      const config = await loadConfig(runtime.env.home);
      const secrets = await loadSecrets(runtime.env.home);
      const fromBody = isRecord(body) ? body : {};
      const apiKey = Object.prototype.hasOwnProperty.call(fromBody, "apiKey")
        ? typeof fromBody.apiKey === "string"
          ? fromBody.apiKey.trim()
          : ""
        : (secrets.xaiApiKey ?? "");
      const model =
        typeof fromBody.model === "string" && fromBody.model.trim().length > 0
          ? fromBody.model.trim()
          : config.llm.model;
      const baseURL =
        typeof fromBody.baseURL === "string" && fromBody.baseURL.trim().length > 0
          ? fromBody.baseURL.trim()
          : config.llm.baseURL;
      const result = await probeLlm({
        apiKey: apiKey ?? "",
        model,
        baseURL,
      });
      return Response.json(result);
    }
    if (url.pathname === "/api/secrets" && req.method === "PUT") {
      const body = await readJson(req);
      if (!isRecord(body) || typeof body.xaiApiKey !== "string" || body.xaiApiKey.trim().length === 0) {
        throw new HttpError(400, "xaiApiKey required");
      }
      await saveXaiApiKey(runtime.env.home, body.xaiApiKey.trim());
      return Response.json({ ok: true });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  } catch (err) {
    return jsonError(err);
  }
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
