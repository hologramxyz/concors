import { expect, it } from "vitest";
import { installRandomUUID } from "./platform";
it("provides secure v4 IDs when the local WebView lacks randomUUID without replacing a working helper", () => {
  const offline: Pick<Crypto, "getRandomValues"> & Partial<Pick<Crypto, "randomUUID">> = {
    getRandomValues: crypto.getRandomValues.bind(crypto),
  };
  installRandomUUID(offline);
  const first = offline.randomUUID?.();
  expect(first).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  expect(offline.randomUUID?.()).not.toBe(first);
  const installed = offline.randomUUID;
  installRandomUUID(offline);
  expect(offline.randomUUID).toBe(installed);
});
