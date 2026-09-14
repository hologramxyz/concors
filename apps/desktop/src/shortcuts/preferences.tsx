import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ShortcutOverrides } from "@concors/client-core";
import { isMac } from "./bindings";
import { parseOverrides, resolveKeymap } from "./keymap";
import {
  PreferencesContext,
  SHORTCUT_STORAGE_KEY,
  readShortcutPreferences,
  type ExternalShortcutPreferences,
} from "./preferences-context";
export function ShortcutPreferencesProvider({
  children,
  external,
}: {
  children: ReactNode;
  external?: ExternalShortcutPreferences;
}) {
  const [stored, setStored] = useState<ShortcutOverrides>(() => {
    try {
      return readShortcutPreferences(window.localStorage);
    } catch {
      return {};
    }
  });
  const externalStorage = !!external;
  useEffect(() => {
    if (externalStorage) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== SHORTCUT_STORAGE_KEY) return;
      try {
        setStored(readShortcutPreferences(window.localStorage));
      } catch {
        /* Keep this window's bindings when storage is unavailable. */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [externalStorage]);
  const overrides = external?.overrides ?? stored;
  const mac = isMac();
  // Mobile state broadcasts recreate objects even when the saved bindings did not change.
  const serialized = JSON.stringify(overrides);
  const keymap = useMemo(
    () => resolveKeymap(parseOverrides(JSON.parse(serialized)), mac),
    [serialized, mac],
  );
  const save = async (next: ShortcutOverrides) => {
    if (external) await external.save(next);
    else {
      // A failed save leaves the active bindings intact and is reported by the editor.
      window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(next));
      setStored(next);
    }
  };
  return (
    <PreferencesContext value={{ overrides, keymap, mac, save }}>{children}</PreferencesContext>
  );
}
