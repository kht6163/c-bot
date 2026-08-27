import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { asOptionalBoolean, asOptionalString, asString, type ToolDefinition } from "./types.ts";
import { resolveWorkspacePath } from "./path.ts";

const READ_CAP = 512 * 1024;

export const readFileTool: ToolDefinition = {
  name: "read_file",
  ui: "generic",
  description: "Read a UTF-8 file in the workspace. Optional offset/limit are 1-based line numbers.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      offset: { type: "integer" },
      limit: { type: "integer" },
    },
    required: ["path"],
  },
  needsApproval: () => false,
  async execute(args, ctx) {
    const rel = asString(args, "path");
    const abs = resolveWorkspacePath(ctx.workspace, rel);
    const buf = await readFile(abs);
    if (buf.byteLength > READ_CAP) {
      throw new Error(`file larger than ${READ_CAP} bytes`);
    }
    let text = buf.toString("utf8");
    const offset = typeof args.offset === "number" ? args.offset : undefined;
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    if (offset !== undefined || limit !== undefined) {
      const lines = text.split("\n");
      const start = Math.max((offset ?? 1) - 1, 0);
      const end = limit !== undefined ? start + limit : lines.length;
      text = lines.slice(start, end).join("\n");
    }
    return text;
  },
};

export const writeFileTool: ToolDefinition = {
  name: "write_file",
  ui: "diff",
  description: "Create or overwrite a UTF-8 file in the workspace.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  needsApproval: () => false,
  async execute(args, ctx) {
    const rel = asString(args, "path");
    const content = asOptionalString(args, "content") ?? "";
    const abs = resolveWorkspacePath(ctx.workspace, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    return `wrote ${rel} (${content.length} chars)`;
  },
};

export const editFileTool: ToolDefinition = {
  name: "edit_file",
  ui: "diff",
  description: "Replace old_string with new_string in a workspace file. Set replace_all to replace every occurrence.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
      replace_all: { type: "boolean" },
    },
    required: ["path", "old_string", "new_string"],
  },
  needsApproval: () => false,
  async execute(args, ctx) {
    const rel = asString(args, "path");
    const oldString = asString(args, "old_string");
    const newString = asOptionalString(args, "new_string") ?? "";
    const replaceAll = asOptionalBoolean(args, "replace_all");
    const abs = resolveWorkspacePath(ctx.workspace, rel);
    const current = await readFile(abs, "utf8");
    if (!current.includes(oldString)) {
      throw new Error("old_string not found");
    }
    const next = replaceAll ? current.split(oldString).join(newString) : current.replace(oldString, newString);
    await writeFile(abs, next, "utf8");
    return `edited ${rel}`;
  },
};

export const listDirTool: ToolDefinition = {
  name: "list_dir",
  ui: "generic",
  description: "List files and directories in a workspace folder.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory relative to the workspace. Default ." },
    },
  },
  needsApproval: () => false,
  async execute(args, ctx) {
    const rel = asOptionalString(args, "path") ?? ".";
    const abs = resolveWorkspacePath(ctx.workspace, rel);
    const entries = await readdir(abs, { withFileTypes: true });
    const lines = await Promise.all(
      entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(async (entry) => {
          const child = join(abs, entry.name);
          const kind = entry.isDirectory() ? "dir" : "file";
          let extra = "";
          if (entry.isFile()) {
            extra = ` ${String((await stat(child)).size)}`;
          }
          return `${kind}\t${relative(ctx.workspace, child)}${extra}`;
        }),
    );
    return lines.join("\n") || "(empty)";
  },
};
