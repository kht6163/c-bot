import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { asOptionalString, asString, type ToolDefinition } from "./types.ts";
import { resolveWorkspacePath } from "./path.ts";

export const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".vite",
  "example-project",
]);
const SKIP = SKIP_DIR_NAMES;
const GREP_CAP = 50;
const GLOB_CAP = 200;
const FILE_CAP = 256 * 1024;

export const grepTool: ToolDefinition = {
  name: "grep",
  ui: "generic",
  description: "Search file contents in the workspace with a regular expression.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string", description: "Subdirectory to search. Default ." },
    },
    required: ["pattern"],
  },
  needsApproval: () => false,
  async execute(args, ctx) {
    const pattern = asString(args, "pattern");
    const rel = asOptionalString(args, "path") ?? ".";
    const root = resolveWorkspacePath(ctx.workspace, rel);
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "g");
    } catch {
      throw new Error("invalid regular expression");
    }
    const hits: string[] = [];
    await walk(root, ctx.workspace, async (file) => {
      if (hits.length >= GREP_CAP) {
        return false;
      }
      const size = (await stat(file)).size;
      if (size > FILE_CAP) {
        return true;
      }
      const text = await readFile(file, "utf8");
      const relFile = relative(ctx.workspace, file);
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i] ?? "")) {
          hits.push(`${relFile}:${i + 1}:${lines[i]}`);
          if (hits.length >= GREP_CAP) {
            break;
          }
        }
      }
      return hits.length < GREP_CAP;
    });
    return hits.join("\n") || "(no matches)";
  },
};

export const globTool: ToolDefinition = {
  name: "glob",
  ui: "generic",
  description: "Find files in the workspace by glob pattern, relative to the workspace root.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob such as **/*.ts" },
    },
    required: ["pattern"],
  },
  needsApproval: () => false,
  async execute(args, ctx) {
    const pattern = asString(args, "pattern");
    const glob = new Bun.Glob(pattern);
    const out: string[] = [];
    for await (const match of glob.scan({ cwd: ctx.workspace, dot: false, onlyFiles: true })) {
      if (match.split(/[\\/]/).some((part) => SKIP.has(part))) {
        continue;
      }
      out.push(match);
      if (out.length >= GLOB_CAP) {
        break;
      }
    }
    return out.join("\n") || "(no matches)";
  },
};

async function walk(
  dir: string,
  workspace: string,
  visit: (file: string) => Promise<boolean>,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, workspace, visit);
    } else if (entry.isFile()) {
      const keep = await visit(full);
      if (!keep) {
        return;
      }
    }
  }
}
