export function assertNever(value: never, message = "unexpected value"): never {
  throw new Error(`${message}: ${String(value)}`);
}
