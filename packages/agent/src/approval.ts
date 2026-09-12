import type { SessionId, ToolCallId } from "@cbot/shared";

interface Pending {
  settle: (allow: boolean) => void;
  rule: string | undefined;
  sessionId: SessionId;
}

export class ApprovalGate {
  private readonly pending = new Map<string, Pending>();

  /** The allow rule the tool offered for this call, while it is still waiting. */
  ruleOf(callId: ToolCallId): string | undefined {
    return this.pending.get(callId)?.rule;
  }

  /** An aborted turn resolves as "not allowed"; the caller checks the signal to tell the two apart. */
  wait(
    callId: ToolCallId,
    sessionId: SessionId,
    signal?: AbortSignal,
    rule?: string,
  ): Promise<boolean> {
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
      this.pending.set(callId, { settle, rule, sessionId });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  settle(callId: ToolCallId, allow: boolean, sessionId: SessionId): boolean {
    const entry = this.pending.get(callId);
    if (!entry || entry.sessionId !== sessionId) {
      return false;
    }
    entry.settle(allow);
    return true;
  }
}
