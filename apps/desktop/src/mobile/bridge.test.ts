import { afterEach, expect, it, vi } from "vitest";

async function setup() {
  vi.useFakeTimers();
  vi.resetModules();
  const nativeWindow = {
    addEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    ReactNativeWebView: { postMessage: vi.fn() },
    concorsMobileReceive: undefined as undefined | ((message: unknown) => void),
  };
  vi.stubGlobal("window", nativeWindow);
  const { embeddedConnection } = await import("./bridge");
  const connection = embeddedConnection("native-session");
  const result = connection.connect().then(
    () => "ready",
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(0);
  return { connection, nativeWindow, result };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("accepts a native bridge reply delayed by cold WebView startup", async () => {
  const { connection, nativeWindow, result } = await setup();
  await vi.advanceTimersByTimeAsync(6_000);
  expect(connection.state.status).toBe("handshaking");
  nativeWindow.concorsMobileReceive?.({
    type: "protocol",
    connectionId: "native-session",
    message: {
      type: "daemon.ready",
      protocolVersion: "v1",
      daemonVersion: "0.2.0",
      status: "ready",
    },
  });
  expect(await result).toBe("ready");
  await vi.advanceTimersByTimeAsync(30_000);
  expect(connection.state.status).toBe("ready");
  connection.disconnect();
});

it("still fails when the native bridge never answers", async () => {
  const { connection, result } = await setup();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await result).toMatchObject({ error: { code: "HANDSHAKE_TIMEOUT" } });
  expect(connection.state.status).toBe("error");
  connection.disconnect();
});

it("does not forward foreground events from an unknown account scope", async () => {
  const { connection, nativeWindow, result } = await setup();
  nativeWindow.concorsMobileReceive?.({ type: "foreground", scope: "old-account" });
  expect(nativeWindow.dispatchEvent).not.toHaveBeenCalled();
  connection.disconnect();
  await result;
});

it("allows cancelling an organization change before any host request is sent", async () => {
  const { connection, nativeWindow, result } = await setup();
  const { guardMobileLeave, hostAction } = await import("./bridge");
  const guard = vi.fn().mockResolvedValue(false);
  const off = guardMobileLeave(guard);
  nativeWindow.ReactNativeWebView.postMessage.mockClear();
  await hostAction({ kind: "switch-organization", organizationId: "another-org" });
  expect(guard).toHaveBeenCalledOnce();
  expect(nativeWindow.ReactNativeWebView.postMessage).not.toHaveBeenCalled();
  off();
  connection.disconnect();
  await result;
});
