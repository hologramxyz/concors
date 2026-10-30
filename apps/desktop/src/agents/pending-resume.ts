/** A CLI's own session that a new chat pane takes over once its chat is ready. */
export interface PendingResume {
  provider: string;
  nativeSessionId: string;
}

// Keyed by pane, set just before its tab is created, so the pane finds it when it mounts.
const pending = new Map<string, PendingResume>();

export function resumeInPane(paneId: string, target: PendingResume): void {
  pending.set(paneId, target);
}
export function pendingResume(paneId: string): PendingResume | undefined {
  return pending.get(paneId);
}
export function forgetPendingResume(paneId: string): void {
  pending.delete(paneId);
}
