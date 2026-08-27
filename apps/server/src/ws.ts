import { PROTOCOL_VERSION, asSessionId, asToolCallId, type ServerFrame } from "@cbot/shared";
import { isRecord } from "./json.ts";
import { acceptUserMessage, settleApproval, type Runtime } from "./runtime.ts";
import type { Socket } from "./hub.ts";

export function onWsOpen(ws: Socket): void {
  const hello: ServerFrame = { type: "hello", version: PROTOCOL_VERSION };
  ws.send(JSON.stringify(hello));
}

export async function onWsMessage(ws: Socket, raw: string | Buffer, runtime: Runtime): Promise<void> {
  const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    sendError(ws, "invalid JSON");
    return;
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    sendError(ws, "invalid frame");
    return;
  }
  if (parsed.type === "subscribe" && typeof parsed.sessionId === "string") {
    runtime.hub.add(asSessionId(parsed.sessionId), ws);
    return;
  }
  if (parsed.type === "send" && typeof parsed.sessionId === "string" && typeof parsed.text === "string") {
    try {
      await acceptUserMessage(runtime, asSessionId(parsed.sessionId), parsed.text);
    } catch (err) {
      sendError(ws, err instanceof Error ? err.message : "send failed");
    }
    return;
  }
  if (
    parsed.type === "approve" &&
    typeof parsed.sessionId === "string" &&
    typeof parsed.callId === "string" &&
    typeof parsed.allow === "boolean"
  ) {
    settleApproval(runtime, asToolCallId(parsed.callId), parsed.allow);
  }
}

function sendError(ws: Socket, message: string): void {
  const frame: ServerFrame = { type: "error", message };
  ws.send(JSON.stringify(frame));
}
