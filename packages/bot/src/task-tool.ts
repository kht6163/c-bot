import type { SessionStore, ToolDefinition } from "@cbot/agent";
import type { BotId, SessionId, TaskStatus } from "@cbot/shared";
import type { BotRecord } from "./types.ts";
import { TaskStore, taskBoardId } from "./task-store.ts";

export function taskTool(opts: {
  home: string;
  store: SessionStore;
  sessionId: SessionId;
  actor: BotRecord;
  roster: readonly BotRecord[];
}): ToolDefinition {
  return {
    name: "task",
    ui: "generic",
    description:
      "Shared task board for this coding session. All bots on the session see the same list. Use list to see work assigned to you (owner=me) or requests from others you have not finished. add registers work. update changes title, detail, owner, or status. remove erases a row. When the lead asks a specialist, add a task owned by that specialist. Break a job into pieces by passing parent: the board is two levels deep, so a subtask cannot have subtasks of its own.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "add", "update", "remove"],
          description:
            "remove erases the row for good, and a job takes its pieces with it. Use it only when the row should not be on the board at all: a mistake, a duplicate, a test row, or the user asked to delete it. Work you finished or decided against is a status change, not a remove. One id per call.",
        },
        id: { type: "string", description: "Task id for update or remove." },
        parent: {
          type: "string",
          description:
            "Parent task id, making this a subtask of that job. One level only. Pass an empty string on update to lift a subtask back to the top.",
        },
        title: { type: "string" },
        detail: { type: "string" },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "cancelled"],
          description:
            "completed = the work got done. cancelled = decided not to do it; the row stays on the board as the record of that decision.",
        },
        owner: { type: "string", description: "Owner handle. Default yourself. Use a teammate handle to assign." },
        query_owner: { type: "string", description: "Filter list by owner handle, or me." },
        query_status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
        assigned: {
          type: "boolean",
          description: "If true, list pending/in_progress tasks owned by you that someone else requested.",
        },
      },
      required: ["action"],
    },
    needsApproval: () => false,
    async execute(args) {
      const store = await TaskStore.open(opts.home);
      try {
        const boardId = taskBoardId(opts.store, opts.sessionId);
        const action = String(args.action ?? "");
        if (action === "list") {
          const assigned = args.assigned === true;
          const owner =
            assigned || args.query_owner === "me"
              ? opts.actor.handle
              : typeof args.query_owner === "string"
                ? args.query_owner.replace(/^@/, "")
                : undefined;
          const status =
            typeof args.query_status === "string" ? (args.query_status as TaskStatus) : undefined;
          let items = store.list(boardId, {
            ...(owner ? { ownerHandle: owner } : {}),
            ...(status ? { status } : {}),
          });
          if (assigned) {
            items = items.filter(
              (item) =>
                item.requesterHandle !== opts.actor.handle &&
                item.status !== "completed" &&
                item.status !== "cancelled",
            );
          }
          return JSON.stringify({ ok: true, tasks: items });
        }
        if (action === "add") {
          const title = String(args.title ?? "");
          const owner = resolveOwner(opts.actor, opts.roster, args.owner);
          const entry = store.create({
            boardId,
            ...(typeof args.parent === "string" ? { parentId: args.parent.trim() || null } : {}),
            title,
            detail: typeof args.detail === "string" ? args.detail : "",
            status: typeof args.status === "string" ? (args.status as TaskStatus) : "pending",
            ownerId: owner.id,
            ownerHandle: owner.handle,
            requesterId: opts.actor.id,
            requesterHandle: opts.actor.handle,
          });
          opts.store.append(boardId, {
            type: "task/change",
            action: "add",
            taskId: entry.id,
            title: entry.title,
            status: entry.status,
            ownerHandle: entry.ownerHandle,
            requesterHandle: entry.requesterHandle,
          });
          return JSON.stringify({ ok: true, task: entry });
        }
        if (action === "update") {
          const id = String(args.id ?? "").trim();
          const owner =
            typeof args.owner === "string" ? resolveOwner(opts.actor, opts.roster, args.owner) : undefined;
          const entry = store.update(id, boardId, {
            ...(typeof args.parent === "string" ? { parentId: args.parent.trim() || null } : {}),
            ...(typeof args.title === "string" ? { title: args.title } : {}),
            ...(typeof args.detail === "string" ? { detail: args.detail } : {}),
            ...(typeof args.status === "string" ? { status: args.status as TaskStatus } : {}),
            ...(owner ? { ownerId: owner.id, ownerHandle: owner.handle } : {}),
          });
          if (!entry) {
            return JSON.stringify({ ok: false, error: "unknown task" });
          }
          opts.store.append(boardId, {
            type: "task/change",
            action: "update",
            taskId: entry.id,
            title: entry.title,
            status: entry.status,
            ownerHandle: entry.ownerHandle,
            requesterHandle: entry.requesterHandle,
          });
          return JSON.stringify({ ok: true, task: entry });
        }
        if (action === "remove" || action === "delete") {
          const id = String(args.id ?? "").trim();
          const gone = store.remove(id, boardId);
          if (gone.length === 0) {
            return JSON.stringify({ ok: false, error: "unknown task" });
          }
          for (const entry of gone) {
            opts.store.append(boardId, {
              type: "task/change",
              action: "remove",
              taskId: entry.id,
              title: entry.title,
              status: entry.status,
              ownerHandle: entry.ownerHandle,
              requesterHandle: entry.requesterHandle,
            });
          }
          return JSON.stringify({
            ok: true,
            removed: gone.length,
            tasks: gone.map((entry) => ({ id: entry.id, title: entry.title })),
          });
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

function resolveOwner(
  actor: BotRecord,
  roster: readonly BotRecord[],
  raw: unknown,
): { id: BotId; handle: string } {
  if (typeof raw !== "string" || raw.trim().length === 0 || raw === "me") {
    return { id: actor.id, handle: actor.handle };
  }
  const handle = raw.replace(/^@/, "").trim();
  const bot = roster.find((item) => item.handle === handle);
  if (!bot) {
    throw new Error(`unknown owner @${handle}`);
  }
  return { id: bot.id, handle: bot.handle };
}
