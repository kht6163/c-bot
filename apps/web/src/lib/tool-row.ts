/**
 * The log shows a tool call as one line — name plus the argument that says what
 * it touched — with the result underneath. Both parts are pure functions of the
 * raw call, so the renderer never has to know a tool's schema.
 */

/**
 * Argument keys worth a headline, most specific first. `pattern` outranks `path`
 * because `grep` carries both and the pattern is what the call is about.
 */
const HEADLINE_KEYS = ["command", "pattern", "path", "target", "action", "title", "id"];

const MAX_HEADLINE = 140;

/**
 * The one argument shown beside the tool name. Arguments arrive as the raw JSON
 * string the model sent, which is still half-written while a call streams, so
 * anything unparsable yields nothing rather than a broken fragment.
 */
export function toolHeadline(argumentsJson: string): string {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return "";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return "";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "";
  }
  const record = parsed as Record<string, unknown>;
  for (const key of HEADLINE_KEYS) {
    const picked = pick(record[key]);
    if (picked) {
      return picked;
    }
  }
  for (const value of Object.values(record)) {
    const picked = pick(value);
    if (picked) {
      return picked;
    }
  }
  return "";
}

/**
 * What belongs in the block under the head line. The result once it lands; until
 * then nothing, because the head line already says what is running — unless no
 * headline could be read, in which case the raw call is better than silence.
 */
export function toolBody(argumentsJson: string, content: string): string {
  if (content.trim()) {
    return content;
  }
  return toolHeadline(argumentsJson) ? "" : argumentsJson.trim();
}

/** Marker state for a tool row: what the dot beside the name means. */
export function toolMark(row: {
  live: boolean;
  ok: boolean;
  pendingApproval: boolean;
}): "waiting" | "running" | "ok" | "failed" {
  if (row.pendingApproval) {
    return "waiting";
  }
  if (row.live) {
    return "running";
  }
  return row.ok ? "ok" : "failed";
}

function pick(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const flat = value.replace(/\s+/g, " ").trim();
  if (!flat) {
    return "";
  }
  return flat.length > MAX_HEADLINE ? `${flat.slice(0, MAX_HEADLINE - 1)}…` : flat;
}
