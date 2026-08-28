import type { ToolDefinition } from "@cbot/agent";
import type { BotId } from "@cbot/shared";
import { MemoryStore } from "./memory-store.ts";

export function memoryTool(home: string, botId: BotId): ToolDefinition {
  return {
    name: "memory",
    ui: "generic",
    description:
      "Persistent notes for THIS bot only. Use add/update/remove for durable facts that should survive sessions. Do not dump the whole conversation. Search returns ranked hits. Keep title short; body is the fact.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "update", "remove", "search"] },
        id: { type: "string", description: "Memory id for update or remove." },
        title: { type: "string" },
        body: { type: "string" },
        query: { type: "string", description: "Search text. Empty lists recent notes." },
      },
      required: ["action"],
    },
    needsApproval: () => false,
    async execute(args) {
      const store = await MemoryStore.open(home, botId);
      try {
        const action = String(args.action ?? "");
        if (action === "add") {
          const entry = store.create({
            title: String(args.title ?? ""),
            body: String(args.body ?? ""),
          });
          return JSON.stringify({ ok: true, memory: entry });
        }
        if (action === "update") {
          const id = String(args.id ?? "").trim();
          const updated = store.update(id, {
            ...(typeof args.title === "string" ? { title: args.title } : {}),
            ...(typeof args.body === "string" ? { body: args.body } : {}),
          });
          if (!updated) {
            return JSON.stringify({ ok: false, error: "unknown memory" });
          }
          return JSON.stringify({ ok: true, memory: updated });
        }
        if (action === "remove") {
          const id = String(args.id ?? "").trim();
          return JSON.stringify({ ok: store.remove(id) });
        }
        if (action === "search") {
          const query = typeof args.query === "string" ? args.query : "";
          return JSON.stringify({ ok: true, memories: store.search(query) });
        }
        return JSON.stringify({ ok: false, error: "unknown action" });
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        store.close();
      }
    },
  };
}
