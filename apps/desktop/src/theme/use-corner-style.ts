import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export const CORNER_STYLES = ["square", "subtle", "rounded"] as const;
export type CornerStyle = (typeof CORNER_STYLES)[number];
export const CORNER_STYLE_KEY = "concors.corner-style";

function readCornerStyle(): CornerStyle {
  try {
    const stored = window.localStorage.getItem(CORNER_STYLE_KEY);
    return CORNER_STYLES.find((style) => style === stored) ?? "subtle";
  } catch {
    return "subtle";
  }
}

/** One preference on the document keeps surfaces and portaled menus in sync. */
export function useCornerStyle() {
  const [preference, setPreferenceState] = useState<CornerStyle>(readCornerStyle);

  useLayoutEffect(() => {
    document.documentElement.dataset["cornerStyle"] = preference;
  }, [preference]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === CORNER_STYLE_KEY || event.key === null)
        setPreferenceState(readCornerStyle());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPreference = useCallback((next: CornerStyle) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(CORNER_STYLE_KEY, next);
    } catch {
      // Keep the preference usable for this session if storage is unavailable.
    }
  }, []);

  return { preference, setPreference };
}
