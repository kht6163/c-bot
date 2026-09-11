import { bashTool } from "./bash.ts";
import { editFileTool, listDirTool, readFileTool, writeFileTool } from "./fs.ts";
import { globTool, grepTool } from "./search.ts";
import { todoWriteTool } from "./todo.ts";
import type { ToolDefinition } from "./types.ts";

export const CODING_TOOLS: readonly ToolDefinition[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  grepTool,
  globTool,
  bashTool,
  todoWriteTool,
];

export function findTool(name: string): ToolDefinition | undefined {
  return CODING_TOOLS.find((tool) => tool.name === name);
}
