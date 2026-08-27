import { PROTOCOL_VERSION, type HealthResponse } from "@cbot/shared";
import { proxyVite } from "./proxy.ts";
import { serveStatic } from "./static.ts";

export type WebMode = "vite" | "static" | "none";

export interface HttpOptions {
  web: WebMode;
  distDir: string;
}

export async function handleHttp(req: Request, opts: HttpOptions): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/api/health") {
    const body: HealthResponse = { ok: true, name: "c-bot", version: PROTOCOL_VERSION };
    return Response.json(body);
  }
  if (url.pathname.startsWith("/api/")) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  if (opts.web === "none") {
    return new Response("not found", { status: 404 });
  }
  if (opts.web === "static") {
    return serveStatic(url.pathname, opts.distDir);
  }
  return proxyVite(req);
}
