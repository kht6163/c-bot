import { type ToolDefinition } from "./types.ts";

export const todoWriteTool: ToolDefinition = {
  name: "todo_write",
  ui: "generic",
  description: "Replace the in-turn todo list. Pass an array of {id, content, status} items. status is pending, in_progress, or completed.",
  parameters: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            content: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
          },
          required: ["id", "content", "status"],
        },
      },
    },
    required: ["todos"],
  },
  needsApproval: () => false,
  async execute(args) {
    const todos = args.todos;
    if (!Array.isArray(todos)) {
      throw new Error("todos must be an array");
    }
    return JSON.stringify(todos, null, 2);
  },
};
