import { loadConfig, loadSecrets, saveConfig, saveXaiApiKey } from "@cbot/agent";
import { asSessionId } from "@cbot/shared";
import { HttpError, isRecord, jsonError, readJson } from "./json.ts";
import { acceptUserMessage, type Runtime } from "./runtime.ts";

export async function handleApi(req: Request, runtime: Runtime): Promise<Response> {
  const url = new URL(req.url);
  try {
    if (url.pathname === "/api/sessions" && req.method === "GET") {
      return Response.json({ sessions: runtime.store.list() });
    }
    if (url.pathname === "/api/sessions" && req.method === "POST") {
      const body = await readJson(req);
      const title = isRecord(body) && typeof body.title === "string" ? body.title : undefined;
      const workspace =
        isRecord(body) && typeof body.workspace === "string" ? body.workspace : null;
      const session = runtime.store.create({
        ...(title !== undefined ? { title } : {}),
        workspace,
      });
      return Response.json({ session }, { status: 201 });
    }
    const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
    if (sessionMatch && req.method === "GET") {
      const id = asSessionId(decodeURIComponent(sessionMatch[1] ?? ""));
      const session = runtime.store.get(id);
      if (!session) {
        throw new HttpError(404, "unknown session");
      }
      return Response.json({ session, events: runtime.store.events(id) });
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
