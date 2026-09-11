import { useCallback, useEffect, useState } from "react";
import { ThemeSelectionSchema, type ThemeSelection } from "@concors/protocol";
const KEY = "concors.color-theme";
function read(): ThemeSelection {
  try {
    return ThemeSelectionSchema.parse(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return { id: "concors" };
  }
}
export function useColorThemePreference() {
  const [selection, setSelection] = useState(read);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === KEY || event.key === null) setSelection(read());
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  const select = useCallback((next: ThemeSelection) => {
    setSelection(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* Retain this session's choice. */
    }
  }, []);
  return { selection, select };
}
