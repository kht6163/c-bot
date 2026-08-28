const VITE_ORIGIN = "http://127.0.0.1:5173";

export async function proxyVite(req: Request): Promise<Response> {
  const incoming = new URL(req.url);
  const target = new URL(incoming.pathname + incoming.search, VITE_ORIGIN);
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "connection" || lower === "content-length") {
      return;
    }
    headers.set(key, value);
  });
  headers.set("host", "127.0.0.1:5173");

  try {
    return await fetch(target, {
      method: req.method,
      headers,
      body: req.body,
      redirect: "manual",
      // Bun requires duplex when forwarding a streamed body.
      duplex: "half",
    } as RequestInit);
  } catch {
    // The Vite worker is a sibling process, so it can still be binding :5173
    // when the first request arrives. Retry the page instead of stranding it.
    return new Response(
      `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="1">c-bot web UI is starting…`,
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}

export function viteDevUrl(): string {
  return VITE_ORIGIN;
}
