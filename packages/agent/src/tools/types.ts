import type { ToolUiKind } from "@cbot/shared";

export interface ToolContext {
  workspace: string;
  approvalMode: "prompt" | "allow";
}

export interface ToolDefinition {
  name: string;
  description: string;
  ui: ToolUiKind;
  parameters: Record<string, unknown>;
  needsApproval(args: Record<string, unknown>, ctx: ToolContext): boolean;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export function schemaOf(tool: ToolDefinition): ToolSchema {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

export function asString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

export function asOptionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

export function asOptionalBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  return value === true;
}
