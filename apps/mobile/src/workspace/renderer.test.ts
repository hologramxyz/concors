import { expect, it } from "vitest";
import { workspaceScript } from "./renderer-types";
it("never interprets daemon output as injected renderer code", () => {
  const message = {
    type: "result" as const,
    scope: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    result: '");globalThis.compromised=true;//\n</script>\u2028\u2029',
  };
  const received: unknown[] = [];
  const script = workspaceScript(message);
  expect(script).not.toContain("</script>");
  new Function("window", script)({
    concorsMobileReceive: (value: unknown) => received.push(value),
  });
  expect(received).toEqual([message]);
});
