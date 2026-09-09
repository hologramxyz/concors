import type { ApiClient } from "@concors/api-client";
import type { MobileApiCall } from "@concors/client-core";

/** Exhaustive dispatch: renderer input is never used for arbitrary property access. */
export function dispatchMobileApi(api: ApiClient, call: MobileApiCall) {
  switch (call.method) {
    case "getMachineCatalog":
      return api.getMachineCatalog();
    case "listMachines":
      return api.listMachines(...call.args);
    case "getMachine":
      return api.getMachine(...call.args);
    case "createMachine":
      return api.createMachine(...call.args);
    case "cancelMachine":
      return api.cancelMachine(...call.args);
    case "resumeMachine":
      return api.resumeMachine(...call.args);
    case "getMachineCosts":
      return api.getMachineCosts(...call.args);
    case "listSshKeys":
      return api.listSshKeys(...call.args);
    case "addSshKey":
      return api.addSshKey(...call.args);
    case "removeSshKey":
      return api.removeSshKey(...call.args);
    case "getBillingStatus":
      return api.getBillingStatus(...call.args);
    case "createBillingSetupUrl":
      return api.createBillingSetupUrl(...call.args);
    case "createBillingPortalUrl":
      return api.createBillingPortalUrl(...call.args);
    case "listInvoices":
      return api.listInvoices(...call.args);
  }
}
