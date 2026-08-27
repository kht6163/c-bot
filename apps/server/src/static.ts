import { join } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export async function serveStatic(pathname: string, distDir: string): Promise<Response> {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const filePath = join(distDir, relative);
  if (!filePath.startsWith(distDir)) {
    return new Response("forbidden", { status: 403 });
  }
  const file = Bun.file(filePath);
  if (await file.exists()) {
    const ext = filePath.slice(filePath.lastIndexOf("."));
    return new Response(file, {
      headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
    });
  }
  const index = Bun.file(join(distDir, "index.html"));
  if (await index.exists()) {
    return new Response(index, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return new Response("web UI is not built", { status: 404 });
}
