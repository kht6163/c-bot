import { asString, type ToolDefinition } from "./types.ts";

const TIMEOUT_MS = 60_000;
const OUTPUT_CAP = 200_000;

export const bashTool: ToolDefinition = {
  name: "bash",
  ui: "terminal",
  description: "Run a bash command with cwd set to the workspace root. Requires approval unless approval.mode is allow.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" },
    },
    required: ["command"],
  },
  needsApproval: (_args, ctx) => ctx.approvalMode !== "allow",
  async execute(args, ctx) {
    const command = asString(args, "command");
    const proc = Bun.spawn(["bash", "-lc", command], {
      cwd: ctx.workspace,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    const timer = setTimeout(() => {
      proc.kill();
    }, TIMEOUT_MS);
    try {
      const [stdout, stderr, exit] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      const body = [`exit ${String(exit)}`, stdout, stderr ? `stderr:\n${stderr}` : ""]
        .filter((part) => part.length > 0)
        .join("\n");
      return body.length > OUTPUT_CAP ? `${body.slice(0, OUTPUT_CAP)}\n…truncated` : body;
    } finally {
      clearTimeout(timer);
    }
  },
};
