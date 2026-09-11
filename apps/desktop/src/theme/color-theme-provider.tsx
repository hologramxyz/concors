import { ColorThemeContext } from "./color-theme-context";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { DaemonConnection } from "@concors/daemon-client";
import {
  COLOR_THEMES,
  DEFAULT_COLOR_THEME,
  customColorTheme,
  type ThemeCatalog,
  type ThemeSelection,
} from "@concors/protocol";
import { applyColorTheme } from "./color-theme";

function useCatalog(connection: DaemonConnection | null) {
  const [snapshot, setSnapshot] = useState<{
    connection: DaemonConnection;
    catalog: ThemeCatalog | null;
    error: string | null;
  } | null>(null);
  const reload = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!connection) {
      reload.current = () => undefined;
      return;
    }
    let disposed = false,
      pending = false,
      lastRequest = 0;
    const load = async (force = false) => {
      if (
        disposed ||
        pending ||
        connection.state.status !== "ready" ||
        !connection.workspace ||
        !connection.state.daemon.capabilities?.includes("color-themes")
      )
        return;
      if (!force && (document.visibilityState === "hidden" || Date.now() - lastRequest < 3000))
        return;
      pending = true;
      lastRequest = Date.now();
      try {
        const result = await connection.requestThemes(crypto.randomUUID());
        if (!disposed)
          setSnapshot((previous) =>
            previous?.connection === connection &&
            !previous.error &&
            JSON.stringify(previous.catalog) === JSON.stringify(result.catalog)
              ? previous
              : { connection, catalog: result.catalog, error: null },
          );
      } catch (cause) {
        if (!disposed)
          setSnapshot((previous) => ({
            connection,
            catalog: previous?.connection === connection ? previous.catalog : null,
            error: cause instanceof Error ? cause.message : "Could not load custom themes",
          }));
      } finally {
        pending = false;
      }
    };
    reload.current = () => void load(true);
    const offState = connection.subscribe(() => void load());
    const offWorkspace = connection.subscribeWorkspace(() => void load());
    const visible = () => void load();
    document.addEventListener("visibilitychange", visible);
    const timer = window.setInterval(() => void load(), 3000);
    void load();
    return () => {
      disposed = true;
      offState();
      offWorkspace();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [connection]);
  const current = snapshot?.connection === connection ? snapshot : null;
  return {
    catalog: current?.catalog ?? null,
    error: current?.error ?? null,
    refresh: useCallback(() => reload.current(), []),
  };
}
export function ColorThemeProvider({
  connection,
  mode,
  selection,
  onSelect,
  children,
}: {
  connection: DaemonConnection | null;
  mode: "light" | "dark";
  selection: ThemeSelection;
  onSelect(selection: ThemeSelection): void;
  children: ReactNode;
}) {
  const { catalog, error, refresh } = useCatalog(connection);
  const themes = useMemo(
    () => [
      ...COLOR_THEMES,
      ...(catalog?.themes ?? (selection.custom ? [selection.custom] : [])).map(customColorTheme),
    ],
    [catalog, selection.custom],
  );
  const selected = themes.find((theme) => theme.id === selection.id) ?? DEFAULT_COLOR_THEME;
  // A file edit should also update the device's offline copy, including native mobile chrome.
  useEffect(() => {
    if (catalog && selected.id !== selection.id) onSelect({ id: selected.id });
    else if (
      selected.custom &&
      JSON.stringify(selected.custom) !== JSON.stringify(selection.custom)
    )
      onSelect({ id: selected.id, custom: selected.custom });
  }, [catalog, selected.id, selected.custom, selection.id, selection.custom, onSelect]);
  useLayoutEffect(() => applyColorTheme(selected, mode), [selected, mode]);
  return (
    <ColorThemeContext
      value={{
        themes,
        selected,
        mode,
        catalog,
        error,
        refresh,
        select: (id) => {
          const theme = themes.find((item) => item.id === id);
          if (theme) onSelect({ id, ...(theme.custom ? { custom: theme.custom } : {}) });
        },
      }}
    >
      {children}
    </ColorThemeContext>
  );
}
