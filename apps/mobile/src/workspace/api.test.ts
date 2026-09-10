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
