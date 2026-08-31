import type { ToolCallId } from "@cbot/shared";

export class ApprovalGate {
  private readonly pending = new Map<string, (allow: boolean) => void>();

  /** An aborted turn resolves as "not allowed"; the caller checks the signal to tell the two apart. */
  wait(callId: ToolCallId, signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve(false);
        return;
      }
      const settle = (allow: boolean) => {
        this.pending.delete(callId);
        signal?.removeEventListener("abort", onAbort);
        resolve(allow);
      };
      const onAbort = () => settle(false);
      this.pending.set(callId, settle);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  settle(callId: ToolCallId, allow: boolean): boolean {
    const resolve = this.pending.get(callId);
    if (!resolve) {
      return false;
    }
    resolve(allow);
    return true;
  }
}
