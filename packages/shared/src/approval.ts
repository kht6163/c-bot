/**
 * Command allow rules. A rule is a leading run of words; a command matches
 * when every shell segment starts with some rule. Anything that can smuggle
 * a second command in — substitution, redirection — never matches, so it
 * still goes to the approval card.
 */
export type ApprovalRemember = "session" | "always";

const RUNNERS = new Set([
  "bun",
  "bunx",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "git",
  "cargo",
  "go",
  "make",
  "docker",
  "kubectl",
  "python",
  "python3",
  "pip",
  "uv",
]);

const SEGMENT_SPLIT = /\|\||&&|[;|\n]/;
const UNSAFE = /[`$<>]/;

/** The words a rule made from this command would keep: the program, plus its subcommand for runners. */
export function commandPrefix(command: string): string {
  const words = firstSegment(command).split(/\s+/).filter((word) => word.length > 0);
  const head = words[0];
  if (!head) {
    return "";
  }
  const sub = words[1];
  if (RUNNERS.has(head) && sub && !sub.startsWith("-")) {
    return `${head} ${sub}`;
  }
  return head;
}

export function isCommandAllowed(command: string, rules: readonly string[]): boolean {
  const trimmed = command.trim();
  if (trimmed.length === 0 || rules.length === 0 || UNSAFE.test(trimmed)) {
    return false;
  }
  const segments = trimmed
    .split(SEGMENT_SPLIT)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return false;
  }
  return segments.every((segment) => rules.some((rule) => matchesRule(segment, rule)));
}

export function normalizeRule(rule: string): string {
  return rule.trim().split(/\s+/).filter((word) => word.length > 0).join(" ");
}

function matchesRule(segment: string, rawRule: string): boolean {
  const rule = normalizeRule(rawRule);
  if (rule.length === 0) {
    return false;
  }
  const normalized = segment.split(/\s+/).filter((word) => word.length > 0).join(" ");
  return normalized === rule || normalized.startsWith(`${rule} `);
}

function firstSegment(command: string): string {
  return command.trim().split(SEGMENT_SPLIT)[0] ?? "";
}
