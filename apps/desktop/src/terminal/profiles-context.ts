import { createContext, useContext } from "react";
import type { SavedTerminalProfile, WorkspaceOperation } from "@concors/protocol";

export interface TerminalProfilesContextValue {
  profiles: readonly SavedTerminalProfile[];
  supported: boolean;
  canEdit: boolean;
  execute: (operation: WorkspaceOperation) => Promise<void>;
  openSettings: (add?: boolean) => void;
}
export const TerminalProfilesContext = createContext<TerminalProfilesContextValue | null>(null);
export function useTerminalProfiles() {
  const value = useContext(TerminalProfilesContext);
  if (!value) throw new Error("Terminal profiles need a workspace provider");
  return value;
}
