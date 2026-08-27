import type { ToolCallId } from "@cbot/shared";

export class ApprovalGate {
  private readonly pending = new Map<string, (allow: boolean) => void>();

  wait(callId: ToolCallId): Promise<boolean> {
    return new Promise((resolve) => {
      this.pending.set(callId, resolve);
    });
  }

  settle(callId: ToolCallId, allow: boolean): boolean {
    const resolve = this.pending.get(callId);
    if (!resolve) {
      return false;
    }
    this.pending.delete(callId);
    resolve(allow);
    return true;
  }
}
