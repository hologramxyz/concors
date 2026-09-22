import { createContext, useContext } from "react";
import type { SavedTerminalProfile } from "@concors/protocol";

export interface TerminalProfilesContextValue {
  profiles: readonly SavedTerminalProfile[];
  supported: boolean;
}
export const TerminalProfilesContext = createContext<TerminalProfilesContextValue | null>(null);
export function useTerminalProfiles() {
  const value = useContext(TerminalProfilesContext);
  if (!value) throw new Error("Terminal profiles need a workspace provider");
  return value;
}
