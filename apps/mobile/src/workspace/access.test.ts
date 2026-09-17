import { expect, it } from "vitest";
import type { MobileAction } from "@concors/client-core";
import { assertWorkspaceActionAllowed } from "./access";
it("direct access allows workspace controls but never cloud account actions", () => {
  for (const action of [
    { kind: "api", call: { method: "listMachines", args: [] } },
    { kind: "switch-organization", organizationId: "org" },
    { kind: "push", enabled: true },
    { kind: "delete-account", password: "x", confirmation: "DELETE" },
  ] satisfies MobileAction[])
    expect(() => assertWorkspaceActionAllowed(true, false, action)).toThrow(
      "Cloud account actions",
    );
  for (const action of [
    { kind: "retry" },
    { kind: "sign-out" },
    { kind: "clipboard", text: "copy" },
    { kind: "open-preview", preview: { port: 5173, protocol: "http" } },
  ] as const) {
    expect(() => assertWorkspaceActionAllowed(true, false, action)).not.toThrow();
    expect(() => assertWorkspaceActionAllowed(false, false, action)).toThrow("Sign in");
  }
});
