import { expect, it } from "vitest";
import {
  IOS_WORKSPACE_ORIGIN,
  isWorkspaceDocument,
  workspaceScript,
  workspaceSource,
} from "./renderer-types";
it("gives only iOS a secure origin, which the navigation gate then lets load", () => {
  expect(workspaceSource("<p>", "android")).toEqual({ html: "<p>" });
  const source = workspaceSource("<p>", "ios");
  expect(source).toEqual({ html: "<p>", baseUrl: IOS_WORKSPACE_ORIGIN });
  expect(new URL(IOS_WORKSPACE_ORIGIN).protocol).toBe("https:");
  expect(isWorkspaceDocument(IOS_WORKSPACE_ORIGIN)).toBe(true);
  expect(isWorkspaceDocument("about:blank")).toBe(true);
  for (const url of [
    "https://concors.dev/",
    `${IOS_WORKSPACE_ORIGIN}other`,
    `${IOS_WORKSPACE_ORIGIN}#fragment`,
    "https://workspace.concors.invalid.example.com/",
  ])
    expect(isWorkspaceDocument(url)).toBe(false);
});
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
