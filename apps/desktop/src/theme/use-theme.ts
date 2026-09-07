import { useCallback, useEffect, useState } from "react";

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "concors.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

/**
 * Light / dark / follow-system theme. Applies a `.dark` class on <html>, which is what the
 * Tailwind `dark:` variant and the shadcn tokens key off.
 */
export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  const resolved: ResolvedTheme =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;

  // Track OS theme changes so "system" stays accurate while the app is open.
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable (restrictive webview); the theme still applies for this session.
    }
  }, []);

  return { preference, resolved, setPreference };
}
