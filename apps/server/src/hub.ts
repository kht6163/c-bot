import type { ServerFrame, SessionEvent, SessionId } from "@cbot/shared";

export interface Socket {
  send(data: string): void;
}

export class EventHub {
  private readonly bySession = new Map<string, Set<Socket>>();
  private readonly sockets = new Map<Socket, Set<string>>();

  add(sessionId: SessionId, ws: Socket): void {
    let group = this.bySession.get(sessionId);
    if (!group) {
      group = new Set();
      this.bySession.set(sessionId, group);
    }
    group.add(ws);
    let joined = this.sockets.get(ws);
    if (!joined) {
      joined = new Set();
      this.sockets.set(ws, joined);
    }
    joined.add(sessionId);
  }

  remove(ws: Socket): void {
    const joined = this.sockets.get(ws);
    if (!joined) {
      return;
    }
    for (const sessionId of joined) {
      this.bySession.get(sessionId)?.delete(ws);
    }
    this.sockets.delete(ws);
  }

  emit(sessionId: SessionId, event: SessionEvent): void {
    const frame: ServerFrame = { type: "event", sessionId, event };
    const payload = JSON.stringify(frame);
    const group = this.bySession.get(sessionId);
    if (!group) {
      return;
    }
    for (const ws of group) {
      try {
        ws.send(payload);
      } catch {
        group.delete(ws);
        this.sockets.get(ws)?.delete(sessionId);
      }
    }
  }
}
