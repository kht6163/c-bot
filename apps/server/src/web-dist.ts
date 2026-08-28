import { join } from "node:path";

/** Static build output, served when NODE_ENV=production. In dev the server
 *  proxies to the Vite worker on :5173, which the root `dev` script starts as
 *  a sibling process — this process never spawns it. */
export function webDistDir(): string {
  return join(import.meta.dir, "../../web/dist");
}
