import type { DaemonEndpoint } from "@concors/daemon-client";
import { useCallback, useEffect, useState } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { ConnectionStatus } from "@/components/connection-status";
import { TooltipProvider } from "@/components/ui/tooltip";
import { resolveStartupEndpoint } from "@/daemon/resolve-endpoint";
import { useDaemonConnection } from "@/daemon/use-daemon-connection";
import { navItemFor, type View } from "@/navigation";
import { useTheme } from "@/theme/use-theme";
import { HomeView } from "@/views/home-view";
import { SettingsView } from "@/views/settings-view";

export function App() {
  const [view, setView] = useState<View>("home");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [endpoint, setEndpoint] = useState<DaemonEndpoint | null>(null);
  const connection = useDaemonConnection(endpoint);
  const theme = useTheme();

  useEffect(() => {
    let cancelled = false;
    void resolveStartupEndpoint().then((resolved) => {
      if (!cancelled) setEndpoint(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const canReconnect =
    connection.state.status === "disconnected" || connection.state.status === "error";

  return (
    <TooltipProvider>
      <div className="flex h-dvh w-full overflow-hidden">
        <AppSidebar view={view} onNavigate={setView} onOpenCommandPalette={openPalette} />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-11 shrink-0 items-center justify-between border-b px-4">
            <h1 className="text-[13px] font-medium">{navItemFor(view).label}</h1>
            <ConnectionStatus
              state={connection.state}
              endpoint={endpoint}
              onReconnect={connection.reconnectNow}
            />
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto">
            {view === "settings" ? (
              <SettingsView
                endpoint={endpoint}
                state={connection.state}
                theme={theme.preference}
                onSetTheme={theme.setPreference}
              />
            ) : (
              <HomeView state={connection.state} />
            )}
          </main>
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNavigate={setView}
        onReconnect={connection.reconnectNow}
        canReconnect={canReconnect}
        onSetTheme={theme.setPreference}
      />
    </TooltipProvider>
  );
}
