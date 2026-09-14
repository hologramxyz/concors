import { expect, it } from "vitest";
import { demoMe } from "../demo/fixtures";
import { createDirectProfileSession } from "./direct-profile";

it("resolves the same GitHub avatar as desktop using only the profile session", async () => {
  const urls: string[] = [];
  const session = createDirectProfileSession("wss://private.example/ws", async (input) => {
    const url = String(input);
    urls.push(url);
    return new Response(
      JSON.stringify(
        url.endsWith("/me")
          ? demoMe
          : {
              configured: true,
              connected: true,
              login: "test-user",
              updatedAt: null,
              manageUrl: null,
            },
      ),
    );
  });
  expect(await session.getProfile()).toEqual({
    ...demoMe.user,
    image: "https://github.com/test-user.png?size=96",
  });
  expect(urls.map((url) => new URL(url).pathname)).toEqual([
    "/profile-api/api/v1/me",
    "/profile-api/api/v1/github/",
  ]);
});

it.each(["disconnected", "unavailable"])(
  "preserves the account profile when GitHub is %s",
  async (status) => {
    const session = createDirectProfileSession("wss://private.example/ws", async (input) => {
      if (String(input).endsWith("/me")) return new Response(JSON.stringify(demoMe));
      return status === "unavailable"
        ? new Response("Not found", { status: 404 })
        : new Response(
            JSON.stringify({
              configured: true,
              connected: false,
              login: null,
              updatedAt: null,
              manageUrl: null,
            }),
          );
    });
    expect(await session.getProfile()).toEqual(demoMe.user);
  },
);

it("signs in against the private profile endpoint with isolated memory credentials", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const session = createDirectProfileSession(
    "wss://private.example/desktop-daemon/ws",
    async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      return new Response(
        JSON.stringify(
          url.endsWith("/sign-in/email")
            ? { user: demoMe.user, token: "profile-only-token" }
            : demoMe,
        ),
      );
    },
  );
  await session.api.signInWithEmail({ email: "test@example.com", password: "fixture" });
  expect((await session.api.getMe()).user).toEqual(demoMe.user);
  expect(requests[0]?.url).toBe(
    "https://private.example/desktop-daemon/profile-api/api/auth/sign-in/email",
  );
  expect(requests[1]?.url).toBe("https://private.example/desktop-daemon/profile-api/api/v1/me");
  expect(new Headers(requests[1]?.init?.headers).get("authorization")).toBe(
    "Bearer profile-only-token",
  );
  expect(requests[0]?.init?.credentials).toBe("omit");
  expect(requests[0]?.init?.redirect).toBe("error");
  session.clear();
  await session.api.getMe();
  expect(new Headers(requests[2]?.init?.headers).has("authorization")).toBe(false);
});

it("rejects insecure, credential-bearing or ambiguous private profile endpoints", () => {
  for (const endpoint of [
    "ws://remote.example/ws",
    "wss://user:secret@private.example/ws",
    "wss://private.example/ws?token=secret",
    "wss://private.example/arbitrary",
  ])
    expect(() => createDirectProfileSession(endpoint)).toThrow();
  expect(() => createDirectProfileSession("ws://localhost:7440/ws")).not.toThrow();
});

it("keeps profile authentication inside a path-hosted preview's private gateway", async () => {
  const requests: string[] = [];
  const session = createDirectProfileSession(
    "wss://private.example/mobile/desktop-daemon/ws",
    async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify(demoMe));
    },
  );
  await session.api.getMe();
  expect(requests).toEqual(["https://private.example/mobile/desktop-daemon/profile-api/api/v1/me"]);
});
