import { expect, it } from "vitest";
import { demoMe } from "../demo/fixtures";
import { createDirectProfileSession } from "./direct-profile";

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
