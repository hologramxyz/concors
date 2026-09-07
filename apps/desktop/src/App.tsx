import type { DaemonEndpoint } from "@concors/daemon-client";
import { useEffect, useState } from "react";

import { MainContent } from "./components/MainContent.tsx";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import { Sidebar, type View } from "./components/Sidebar.tsx";
import { StatusIndicator } from "./components/StatusIndicator.tsx";
import { resolveStartupEndpoint } from "./daemon/resolve-endpoint.ts";
import { useDaemonConnection } from "./daemon/use-daemon-connection.ts";

export function App() {
  const [view, setView] = useState<View>("home");
  const [endpoint, setEndpoint] = useState<DaemonEndpoint | null>(null);
  const connection = useDaemonConnection(endpoint);

  useEffect(() => {
    let cancelled = false;
    void resolveStartupEndpoint().then((resolved) => {
      if (!cancelled) setEndpoint(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <Sidebar view={view} onNavigate={setView} />
      <main className="main">
        <header className="topbar">
          <span className="topbar__title">{view === "settings" ? "Settings" : "Concors"}</span>
          <StatusIndicator
            state={connection.state}
            endpoint={endpoint}
            onReconnect={connection.reconnectNow}
          />
        </header>
        <section className="content">
          {view === "settings" ? (
            <SettingsPanel endpoint={endpoint} />
          ) : (
            <MainContent state={connection.state} />
          )}
        </section>
      </main>
    </div>
  );
}
