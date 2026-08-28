import { join, resolve } from "node:path";
import { applyEnvFile } from "@cbot/agent";
import { loadProcessEnv } from "./env.ts";
import { handleHttp, type WebMode } from "./http.ts";
import { createRuntime } from "./runtime.ts";
import { startVite, viteWebRoot, webDistDir } from "./vite-child.ts";
import { onWsMessage, onWsOpen } from "./ws.ts";

const repoRoot = join(import.meta.dir, "../../..");
await applyEnvFile(join(repoRoot, ".env"));
const env = loadProcessEnv();
await applyEnvFile(join(env.home, ".env"));
const production = process.env.NODE_ENV === "production";
const web: WebMode = production ? "static" : "vite";
const runtime = await createRuntime(env, undefined, resolve(repoRoot));

if (web === "vite") {
  startVite(viteWebRoot());
}

const server = Bun.serve({
  hostname: env.host,
  port: env.port,
  fetch(req, bunServer) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (bunServer.upgrade(req)) {
        return;
      }
      return new Response("upgrade failed", { status: 400 });
    }
    return handleHttp(req, { web, distDir: webDistDir(), runtime });
  },
  websocket: {
    open(ws) {
      onWsOpen(ws);
    },
    message(ws, message) {
      void onWsMessage(ws, message, runtime);
    },
    close(ws) {
      runtime.hub.remove(ws);
    },
  },
});

console.log(`c-bot listening on http://${server.hostname}:${server.port}`);
if (web === "vite") {
  console.log("Open that URL in the browser. Vite :5173 is only the UI hot-reload worker.");
}
