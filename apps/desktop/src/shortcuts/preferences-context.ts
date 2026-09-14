import { createContext, useContext } from "react";
import type { ShortcutOverrides } from "@concors/client-core";
import type { CommandId } from "./bindings";
import { bindingLabel, parseOverrides, type Keymap } from "./keymap";
export const SHORTCUT_STORAGE_KEY = "concors.shortcuts.v1";
export function readShortcutPreferences(storage: Pick<Storage, "getItem">): ShortcutOverrides {
  try {
    return parseOverrides(JSON.parse(storage.getItem(SHORTCUT_STORAGE_KEY) ?? "{}"));
  } catch {
    return {};
  }
}
interface Preferences {
  overrides: ShortcutOverrides;
  keymap: Keymap;
  mac: boolean;
  save(overrides: ShortcutOverrides): Promise<void>;
}
export const PreferencesContext = createContext<Preferences | null>(null);
export interface ExternalShortcutPreferences {
  overrides: ShortcutOverrides;
  save(overrides: ShortcutOverrides): Promise<unknown>;
}
export function useShortcutPreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("ShortcutProvider is missing");
  return value;
}
/** Menu hints subscribe to the same bindings used by keyboard dispatch. */
export function useShortcutLabels() {
  const { keymap, mac } = useShortcutPreferences();
  return (id: CommandId) => (keymap[id][0] ? bindingLabel(keymap[id][0], mac) : "Unassigned");
}
