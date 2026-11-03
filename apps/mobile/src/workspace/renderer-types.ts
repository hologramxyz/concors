import type { MobileHostMessage } from "@concors/client-core";
export interface WorkspaceRendererHandle {
  send(message: MobileHostMessage): void;
}
export interface WorkspaceRendererProps {
  backgroundColor: string;
  onMessage(raw: unknown): void;
  onError(): void;
}
/**
 * WebKit only offers the microphone to a secure origin, and a page loaded from a string has none
 * of its own, so iOS gives the workspace this one. Nothing is ever fetched from it: `.invalid`
 * never resolves and the page's content security policy forbids connections. Android keeps its
 * opaque origin, where no microphone is offered and dictation stays with the keyboard.
 */
export const IOS_WORKSPACE_ORIGIN = "https://workspace.concors.invalid/";

export function workspaceSource(html: string, platform: string) {
  return platform === "ios" ? { html, baseUrl: IOS_WORKSPACE_ORIGIN } : { html };
}

/** The workspace page itself is the only thing its webview may load. */
export function isWorkspaceDocument(url: string) {
  return url === "about:blank" || url === IOS_WORKSPACE_ORIGIN;
}

export function workspaceScript(message: MobileHostMessage) {
  return `window.concorsMobileReceive?.(${JSON.stringify(message).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029")});true;`;
}
