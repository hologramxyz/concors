import type { MobileHostMessage } from "@concors/client-core";
export interface WorkspaceRendererHandle {
  send(message: MobileHostMessage): void;
}
export interface WorkspaceRendererProps {
  onMessage(raw: unknown): void;
  onError(): void;
}
export function workspaceScript(message: MobileHostMessage) {
  return `window.concorsMobileReceive?.(${JSON.stringify(message).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029")});true;`;
}
