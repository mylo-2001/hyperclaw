/**
 * src/infra/pending-approval.ts
 * Pending destructive actions awaiting user confirmation.
 */

export interface PendingAction {
  toolName: string;
  input: Record<string, unknown>;
  execute: () => Promise<string>;
}

const pending = new Map<string, PendingAction>();

export function getPending(sessionId: string): PendingAction | undefined {
  return pending.get(sessionId);
}

export function setPending(sessionId: string, action: PendingAction): void {
  pending.set(sessionId, action);
}

export function clearPending(sessionId: string): boolean {
  return pending.delete(sessionId);
}
