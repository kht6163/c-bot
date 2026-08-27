import { PROTOCOL_VERSION, type ServerFrame } from "@cbot/shared";

export function onWsOpen(ws: { send(data: string): void }): void {
  const hello: ServerFrame = { type: "hello", version: PROTOCOL_VERSION };
  ws.send(JSON.stringify(hello));
}
