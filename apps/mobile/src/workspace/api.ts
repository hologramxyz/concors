import type { ApiClient } from "@concors/api-client";
import type { MobileApiCall } from "@concors/client-core";

/** Exhaustive dispatch: renderer input is never used for arbitrary property access. */
export function dispatchMobileApi(api: ApiClient, call: MobileApiCall) {
  assertCompanionApiAllowed(call);
  switch (call.method) {
    case "getMachineCatalog":
      return api.getMachineCatalog();
    case "listMachines":
      return api.listMachines(...call.args);
    case "getMachine":
      return api.getMachine(...call.args);
    case "renameMachine":
      return api.renameMachine(...call.args);
    case "updateMachineIcon":
      return api.updateMachineIcon(...call.args);
    case "githubStatus":
      return api.githubStatus();
    case "connectGitHub":
      return api.connectGitHub();
    case "disconnectGitHub":
      return api.disconnectGitHub();
    case "githubAccounts":
      return api.githubAccounts(...call.args);
    case "githubRepositories":
      return api.githubRepositories(...call.args);
    case "prepareGitHubMachine":
      return api.prepareGitHubMachine(...call.args);
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

/** Product boundary applies to every mobile build, including renderer-originated RPCs. */
export function assertCompanionApiAllowed(call: MobileApiCall) {
  if (
    ![
      "listMachines",
      "getMachine",
      "renameMachine",
      "updateMachineIcon",
      "githubStatus",
      "connectGitHub",
      "disconnectGitHub",
      "githubAccounts",
      "githubRepositories",
      "prepareGitHubMachine",
      "listSshKeys",
      "addSshKey",
      "removeSshKey",
    ].includes(call.method)
  )
    throw new Error(
      "Purchasing, subscriptions and billing are unavailable in the mobile companion.",
    );
}
