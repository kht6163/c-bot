/**
 * Messages typed while a turn is running. They are drafts, not session log
 * entries: nothing reaches the server until the queue is drained, so a queued
 * message can still be pulled back into the composer or dropped.
 */
export interface QueuedMessage {
  id: string;
  text: string;
}

export type Queues = Readonly<Record<string, readonly QueuedMessage[]>>;

export function queuedFor(queues: Queues, sessionId: string | undefined): readonly QueuedMessage[] {
  return (sessionId ? queues[sessionId] : undefined) ?? EMPTY;
}

export function enqueue(queues: Queues, sessionId: string, item: QueuedMessage): Queues {
  return { ...queues, [sessionId]: [...queuedFor(queues, sessionId), item] };
}

export function dropQueued(queues: Queues, sessionId: string, id: string): Queues {
  const rest = queuedFor(queues, sessionId).filter((item) => item.id !== id);
  if (rest.length === 0) {
    const next = { ...queues };
    delete next[sessionId];
    return next;
  }
  return { ...queues, [sessionId]: rest };
}

export function clearQueue(queues: Queues, sessionId: string): Queues {
  if (!(sessionId in queues)) {
    return queues;
  }
  const next = { ...queues };
  delete next[sessionId];
  return next;
}

const EMPTY: readonly QueuedMessage[] = [];
