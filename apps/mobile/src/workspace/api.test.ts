import { expect, it, vi } from "vitest";
import type { ApiClient } from "@concors/api-client";
import type { MobileApiCall } from "@concors/client-core";
import { assertCompanionApiAllowed, dispatchMobileApi } from "./api";

it("rejects every commerce RPC before dispatch, including a forged renderer request", () => {
  const accessed = vi.fn();
  const api = new Proxy({} as ApiClient, { get: accessed });
  for (const method of [
    "createMachine",
    "cancelMachine",
    "resumeMachine",
    "getMachineCatalog",
    "getMachineCosts",
    "getBillingStatus",
    "createBillingSetupUrl",
    "createBillingPortalUrl",
    "listInvoices",
  ]) {
    expect(() => dispatchMobileApi(api, { method, args: [] } as unknown as MobileApiCall)).toThrow(
      "mobile companion",
    );
  }
  expect(accessed).not.toHaveBeenCalled();
});
it("retains existing-machine access and SSH key management", () => {
  for (const method of ["listMachines", "getMachine", "listSshKeys", "addSshKey", "removeSshKey"])
    expect(() =>
      assertCompanionApiAllowed({ method, args: [] } as unknown as MobileApiCall),
    ).not.toThrow();
});
it("dispatches only the explicit GitHub and machine metadata methods", async () => {
  const calls: MobileApiCall[] = [
    { method: "githubStatus", args: [] },
    { method: "connectGitHub", args: [] },
    { method: "disconnectGitHub", args: [] },
    { method: "githubAccounts", args: [2] },
    { method: "githubRepositories", args: [123, 3] },
    { method: "prepareGitHubMachine", args: ["machine", "org/repo"] },
    { method: "renameMachine", args: ["machine", "new-name"] },
    { method: "updateMachineIcon", args: ["machine", "🚀"] },
  ];
  for (const call of calls) {
    const method = vi.fn().mockResolvedValue({ ok: true });
    const api = { [call.method]: method } as unknown as ApiClient;
    await expect(dispatchMobileApi(api, call)).resolves.toEqual({ ok: true });
    expect(method).toHaveBeenCalledExactlyOnceWith(...call.args);
  }
});
