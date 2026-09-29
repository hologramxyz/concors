import { createApiClient, memoryTokenStore } from "@concors/api-client";
import { afterEach, expect, it, vi } from "vitest";
import { demoMe } from "../demo/fixtures";
import { createMobileApiFetch } from "./api-fetch";

const apiUrl = "https://api.concors.dev";
afterEach(() => vi.useRealTimers());

it("signs in, reads the profile and signs out against an Origin-checking API", async () => {
  const calls: { path: string; headers: Headers; init?: RequestInit }[] = [];
  const request: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const headers = new Headers(init?.headers);
    calls.push({ path, headers, init });
    if (headers.get("origin") !== apiUrl)
      return Response.json({ code: "MISSING_OR_NULL_ORIGIN" }, { status: 403 });
    if (path === "/api/v1/native-auth/exchange") return Response.json({ token: "test-session" });
    if (headers.get("authorization") !== "Bearer test-session")
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    return Response.json(path === "/api/v1/me" ? demoMe : {});
  };
  const tokens = memoryTokenStore();
  const api = createApiClient({
    baseUrl: apiUrl,
    tokenStore: tokens,
    fetch: createMobileApiFetch({ apiUrl, native: true, request }),
  });
  await api.completeNativeSignIn({ code: "c".repeat(43), verifier: "v".repeat(43) });
  expect((await api.getMe()).user).toEqual(demoMe.user);
  await api.signOut();
  expect(tokens.get()).toBeNull();
  expect(calls.map(({ path }) => path)).toEqual([
    "/api/v1/native-auth/exchange",
    "/api/v1/me",
    "/api/auth/sign-out",
  ]);
  for (const { init } of calls) {
    expect(init?.credentials).toBe("omit");
    expect(init?.redirect).toBe("error");
  }
  expect(calls[0]?.headers.get("content-type")).toBe("application/json");
  expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
    code: "c".repeat(43),
    verifier: "v".repeat(43),
  });
});

it("derives native Origin from the configured API, including a port but not its path", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response());
  const fetchApi = createMobileApiFetch({
    apiUrl: "http://localhost:4000/backend",
    native: true,
    request,
  });
  const headers = new Headers({ authorization: "Bearer fixture", origin: "https://wrong.invalid" });
  await fetchApi("http://localhost:4000/backend/api/v1/me", { headers });
  const sent = new Headers(request.mock.calls[0]?.[1]?.headers);
  expect(sent.get("origin")).toBe("http://localhost:4000");
  expect(sent.get("authorization")).toBe("Bearer fixture");
  expect(headers.get("origin")).toBe("https://wrong.invalid");
});

it("leaves web Origin handling to the browser", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response());
  await createMobileApiFetch({ apiUrl, native: false, request })(`${apiUrl}/api/v1/me`);
  expect(new Headers(request.mock.calls[0]?.[1]?.headers).has("origin")).toBe(false);
});

it("preserves Request headers and explicit header overrides", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response());
  const original = new Request(`${apiUrl}/api/v1/me`, {
    headers: { authorization: "Bearer old", accept: "application/json" },
  });
  await createMobileApiFetch({ apiUrl, native: true, request })(original, {
    headers: { authorization: "Bearer newer" },
  });
  const sent = new Headers(request.mock.calls[0]?.[1]?.headers);
  expect(sent.get("authorization")).toBe("Bearer newer");
  expect(sent.get("accept")).toBe("application/json");
  expect(original.headers.get("authorization")).toBe("Bearer old");
});

it("rejects a foreign origin before sending credentials", async () => {
  const request = vi.fn<typeof fetch>();
  const fetchApi = createMobileApiFetch({ apiUrl, native: true, request });
  for (const url of ["https://other.invalid/api/v1/me", "http://api.concors.dev/me"])
    await expect(fetchApi(url, { headers: { authorization: "Bearer fixture" } })).rejects.toThrow(
      "outside the configured mobile API",
    );
  expect(request).not.toHaveBeenCalled();
});

it("times out stalled requests and cleans up after errors", async () => {
  vi.useFakeTimers();
  const request = vi.fn<typeof fetch>().mockImplementation(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  );
  const pending = createMobileApiFetch({ apiUrl, native: true, request })(`${apiUrl}/api/v1/me`);
  const failure = expect(pending).rejects.toThrow("aborted");
  await vi.advanceTimersByTimeAsync(15_000);
  await failure;
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves caller cancellation and clears the deadline after success", async () => {
  vi.useFakeTimers();
  const caller = new AbortController();
  const request = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
    expect(init?.signal?.aborted).toBe(false);
    caller.abort();
    expect(init?.signal?.aborted).toBe(true);
    return new Response();
  });
  await createMobileApiFetch({ apiUrl, native: true, request })(`${apiUrl}/api/v1/me`, {
    signal: caller.signal,
  });
  expect(vi.getTimerCount()).toBe(0);
});
