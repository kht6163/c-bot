import { loadProcessEnv } from "./env.ts";
import { handleHttp, type WebMode } from "./http.ts";
import { startVite, viteWebRoot, webDistDir } from "./vite-child.ts";
import { onWsOpen } from "./ws.ts";

const env = loadProcessEnv();
const production = process.env.NODE_ENV === "production";
const web: WebMode = production ? "static" : "vite";

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
    return handleHttp(req, { web, distDir: webDistDir() });
  },
  websocket: {
    open(ws) {
      onWsOpen(ws);
    },
    message() {
      // Session subscribe/send land in a later change.
    },
    close() {},
  },
});

console.log(`c-bot listening on http://${server.hostname}:${server.port}`);
