import type { SessionStore } from "@cbot/agent";
import type { BotId, SessionEvent, SessionId } from "@cbot/shared";
import { MemoryStore } from "./memory-store.ts";

export function lastInputText(events: readonly SessionEvent[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type === "user/message" || event?.type === "bot/message") {
      return event.text;
    }
  }
  return "";
}

export function recalledForLastInput(events: readonly SessionEvent[]): boolean {
  let lastInput = 0;
  let lastRecall = 0;
  for (const event of events) {
    if (event.type === "user/message" || event.type === "bot/message") {
      lastInput = event.seq;
    }
    if (event.type === "memory/recall") {
      lastRecall = event.seq;
    }
  }
  return lastRecall > lastInput && lastInput > 0;
}

export async function recallIntoSession(
  home: string,
  botId: BotId,
  store: SessionStore,
  sessionId: SessionId,
): Promise<void> {
  const events = store.events(sessionId);
  if (recalledForLastInput(events)) {
    return;
  }
  const query = lastInputText(events).trim();
  if (query.length === 0) {
    return;
  }
  const memory = await MemoryStore.open(home, botId);
  try {
    const items = memory.search(query).map((item) => ({
      id: item.id,
      title: item.title,
      body: item.body,
    }));
    if (items.length === 0) {
      return;
    }
    store.append(sessionId, { type: "memory/recall", botId, query, items });
  } finally {
    memory.close();
  }
}
