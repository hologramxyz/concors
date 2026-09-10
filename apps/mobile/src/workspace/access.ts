import type { MobileAction } from "@concors/client-core";

/** Direct daemon access is not an account session and never grants control-plane privileges. */
export function assertWorkspaceActionAllowed(
  direct: boolean,
  signedIn: boolean,
  action: MobileAction,
) {
  if (!direct && !signedIn) throw new Error("Sign in again");
  if (direct && ["api", "switch-organization", "push", "delete-account"].includes(action.kind))
    throw new Error("Cloud account actions are unavailable in a direct desktop connection.");
}
