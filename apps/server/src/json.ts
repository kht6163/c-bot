export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function jsonError(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "internal error";
  const status =
    message === "unknown session" ||
    message === "empty message" ||
    message === "workspace required" ||
    message === "project required" ||
    message === "direct bot chat is disabled" ||
    message === "leader cannot be deleted" ||
    message === "handle leader is reserved" ||
    message.startsWith("handle")
      ? 400
      : 500;
  return Response.json({ error: message }, { status });
}
