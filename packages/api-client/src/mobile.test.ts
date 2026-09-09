import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client.ts";
import { memoryTokenStore } from "./token-store.ts";
import { MachineConnectionTicketSchema, NO_MOBILE_CAPABILITIES } from "./mobile.ts";
const ticket = {
  machineId: "machine-1",
  url: "wss://gateway.example/ws",
  ticket: "a_safe_one_use_ticket",
  expiresAt: "2099-01-01T00:00:00.000Z",
};
function client(body: unknown, status = 200) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  return {
    api: createApiClient({
      baseUrl: "https://api.example",
      tokenStore: memoryTokenStore("session-token"),
      fetch,
    }),
    fetch,
  };
}
describe("optional mobile control-plane contract", () => {
  it("treats only a missing capabilities route as unsupported", async () => {
    expect(await client({}, 404).api.getMobileCapabilities()).toEqual(NO_MOBILE_CAPABILITIES);
    await expect(client({}, 401).api.getMobileCapabilities()).rejects.toMatchObject({
      status: 401,
    });
    await expect(client({}, 503).api.getMobileCapabilities()).rejects.toMatchObject({
      status: 503,
    });
  });
  it("validates every connection and keeps the long-lived token out of the returned URL", async () => {
    const { api, fetch } = client(ticket);
    expect(await api.connectMachine("machine-1")).toEqual(ticket);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/api/v1/machines/machine-1/connect");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer session-token");
  });
  it("rejects expired and wrong-machine tickets", async () => {
    await expect(client(ticket).api.connectMachine("other")).rejects.toMatchObject({
      code: "INVALID_TICKET",
    });
    await expect(
      client({ ...ticket, expiresAt: "2000-01-01T00:00:00.000Z" }).api.connectMachine("machine-1"),
    ).rejects.toMatchObject({ code: "INVALID_TICKET" });
  });
  it.each([
    "ws://gateway.example/ws",
    "wss://user:password@gateway.example/ws",
    "wss://gateway.example/ws?token=secret",
    "https://gateway.example/ws",
  ])("rejects unsafe endpoint %s", (url) => {
    expect(MachineConnectionTicketSchema.safeParse({ ...ticket, url }).success).toBe(false);
  });
  it("does not claim deletion succeeded on an unexpected response", async () => {
    await expect(client({}).api.deleteAccount("password")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    expect(await client({ status: "scheduled" }).api.deleteAccount("password")).toBe("scheduled");
  });
});
