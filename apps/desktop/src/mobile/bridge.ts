import { ApiError } from "@concors/api-client";
import {
  MobileHostMessageSchema,
  type MobileAction,
  type MobileHostMessage,
  type MobileRendererMessage,
  type MobileState,
} from "@concors/client-core";
import {
  DaemonConnection,
  describeDaemonEndpoint,
  type WebSocketLike,
} from "@concors/daemon-client";
import type { ClientMessage } from "@concors/protocol";

type NativeWindow = Window & {
  ReactNativeWebView?: { postMessage(raw: string): void };
  concorsMobileReceive?: (message: unknown) => void;
};
const listeners = new Set<(message: MobileHostMessage) => void>();
let state: MobileState | null = null;
const pending = new Map<
  string,
  {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
export function sendHost(message: MobileRendererMessage) {
  const native = (window as NativeWindow).ReactNativeWebView;
  if (native) native.postMessage(JSON.stringify(message));
  else window.parent.postMessage({ concorsMobile: message }, "*");
}
function receive(raw: unknown) {
  const result = MobileHostMessageSchema.safeParse(raw);
  if (!result.success) return;
  const message = result.data;
  if (message.type === "foreground" && message.scope === state?.scope)
    window.dispatchEvent(new Event("concors-foreground"));
  if (message.type === "state") {
    if (state && message.state.scope !== state.scope) {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Account changed"));
      }
      pending.clear();
    }
    state = message.state;
  }
  if (message.type === "result" && message.scope === state?.scope) {
    const request = pending.get(message.requestId);
    if (request) {
      clearTimeout(request.timer);
      pending.delete(message.requestId);
      if (message.error)
        request.reject(
          message.error.status
            ? new ApiError(message.error.status, message.error.message, message.error.code)
            : new Error(message.error.message),
        );
      else request.resolve(message.result);
    }
  }
  for (const listener of listeners) listener(message);
}
(window as NativeWindow).concorsMobileReceive = receive;
window.addEventListener("message", (event) => {
  if (
    event.source === window.parent &&
    event.data &&
    typeof event.data === "object" &&
    "concorsMobile" in event.data
  )
    receive(event.data.concorsMobile);
});
export function subscribeHost(listener: (message: MobileHostMessage) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getHostState() {
  return state;
}
let beforeLeave: (() => boolean | Promise<boolean>) | null = null;
export function guardMobileLeave(guard: () => boolean | Promise<boolean>) {
  beforeLeave = guard;
  return () => {
    if (beforeLeave === guard) beforeLeave = null;
  };
}
export async function hostAction(action: MobileAction): Promise<unknown> {
  if (
    ["sign-out", "delete-account", "switch-organization"].includes(action.kind) &&
    beforeLeave &&
    !(await beforeLeave())
  )
    return;
  if (!state) return Promise.reject(new Error("Mobile host is not ready"));
  const scope = state.scope;
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("Request timed out. Check its state before retrying."));
    }, 35_000);
    pending.set(requestId, { resolve, reject, timer });
    sendHost({ type: "action", requestId, scope, action });
  });
}
/** A real protocol replica, not a mocked desktop connection or a second network socket. */
export function embeddedConnection(connectionId: string) {
  return new DaemonConnection({
    endpoint: describeDaemonEndpoint("wss://native.concors.invalid/ws"),
    client: { kind: "mobile", name: "concors-mobile-ui", version: "0.1.0" },
    // Native WebView startup can delay both JS runtimes beyond a network socket handshake.
    handshakeTimeoutMs: 30_000,
    webSocketFactory: () => new BridgeSocket(connectionId),
    // The native host resolves the authenticated address when it receives open-preview.
    previewUrl: (preview) => `https://preview.invalid/${preview.protocol}/${preview.port}`,
  });
}
class BridgeSocket implements WebSocketLike {
  readyState = 0;
  private listeners = new Map<
    string,
    ((event: { data: unknown; code: number; reason: string }) => void)[]
  >();
  private unsubscribe: () => void;
  private connectionId: string;
  constructor(connectionId: string) {
    this.connectionId = connectionId;
    this.unsubscribe = subscribeHost((message) => {
      if (
        message.type === "protocol" &&
        message.connectionId === connectionId &&
        this.readyState === 1
      )
        this.dispatch("message", JSON.stringify(message.message));
    });
    queueMicrotask(() => {
      if (this.readyState === 0) {
        this.readyState = 1;
        this.dispatch("open");
      }
    });
  }
  addEventListener(
    type: string,
    listener: (event: { data: unknown; code: number; reason: string }) => void,
  ) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  private dispatch(type: string, data?: unknown) {
    for (const listener of this.listeners.get(type) ?? [])
      listener({ data, code: 1000, reason: "Native connection changed" });
  }
  send(raw: string) {
    if (this.readyState !== 1) throw new Error("Renderer is disconnected");
    sendHost({
      type: "protocol",
      connectionId: this.connectionId,
      message: JSON.parse(raw) as ClientMessage,
    });
  }
  close() {
    this.readyState = 3;
    this.unsubscribe();
    this.dispatch("close");
  }
}
