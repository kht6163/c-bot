import { join } from "node:path";

let child: ReturnType<typeof Bun.spawn> | undefined;

export function startVite(webRoot: string): void {
  if (child) {
    return;
  }
  child = Bun.spawn({
    cmd: ["bun", "x", "--bun", "vite"],
    cwd: webRoot,
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
}

export function viteWebRoot(): string {
  return join(import.meta.dir, "../../web");
}

export function webDistDir(): string {
  return join(viteWebRoot(), "dist");
}
