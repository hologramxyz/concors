import { useContext, useEffect, useState } from "react";
import {
  MACHINE_PLUGINS_CAPABILITY,
  type AgentPlugin,
  type ProviderStatus,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Section, SettingsCard } from "@/views/settings-primitives";

/** Where each CLI installs plugins, since Concors leaves installing them to the CLI. */
const INSTALL_HINTS: Record<string, string> = {
  claude: "Install one in a terminal on this machine with /plugin in Claude Code.",
  codex: "Install one in a terminal on this machine with /plugins in Codex.",
};

/**
 * The plugins Claude Code and Codex have installed on the connected machine, each with a switch.
 * The CLIs own their plugins, so installing one, and signing in to the service it connects to,
 * still happen in the CLI; this page shows what every chat gets and turns plugins on or off.
 */
export function PluginsSettings() {
  const connection = useContext(TerminalConnectionContext);
  const [state, setState] = useState(connection?.state);
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => connection?.subscribe(setState), [connection]);
  const supported =
    state?.status === "ready" && !!state.daemon.capabilities?.includes(MACHINE_PLUGINS_CAPABILITY);
  useEffect(() => {
    if (!supported || !connection) return;
    let cancelled = false;
    connection.requestProvider({ kind: "list" }, crypto.randomUUID()).then(
      (result) => {
        if (cancelled) return;
        if (result.outcome.status === "error") setError(result.outcome.message);
        else
          setProviders(
            // The machine's own Claude Code and Codex; a subscription shares their plugins' setup.
            result.outcome.providers.filter(
              (p) => (p.id === "claude" || p.id === "codex") && p.installed && p.enabled,
            ),
          );
      },
      (cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Could not load providers.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [supported, connection]);
  return (
    <Section
      title="Plugins"
      description="Skills, commands and tools that Claude Code and Codex plugins add to every chat on this machine."
    >
      {!supported ? (
        <p role="status" className="text-sm text-muted-foreground">
          {state?.status === "ready"
            ? "Update this machine’s Concors service to see its plugins here."
            : "Connect to a machine to see its plugins."}
        </p>
      ) : !providers ? (
        !error && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading plugins…
          </p>
        )
      ) : providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Neither Claude Code nor Codex is installed on this machine.
        </p>
      ) : (
        <div className="space-y-6">
          {providers.map((provider) => (
            <ProviderPlugins key={provider.id} provider={provider} />
          ))}
          <p className="text-sm text-muted-foreground">
            Chats started after a change load it; open chats keep the plugins they started with. A
            plugin that connects to an account asks you to sign in through its CLI.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </Section>
  );
}

function ProviderPlugins({ provider }: { provider: ProviderStatus }) {
  const connection = useContext(TerminalConnectionContext);
  const [plugins, setPlugins] = useState<AgentPlugin[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    connection.requestProvider({ kind: "plugins", id: provider.id }, crypto.randomUUID()).then(
      (result) => {
        if (cancelled) return;
        if (result.outcome.status === "error") setError(result.outcome.message);
        else setPlugins(result.outcome.plugins ?? []);
      },
      (cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Could not load plugins.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [connection, provider.id]);
  const toggle = (plugin: AgentPlugin, enabled: boolean) => {
    if (!connection || busy) return;
    setBusy(plugin.id);
    setError(null);
    connection
      .requestProvider(
        { kind: "plugin-enable", id: provider.id, plugin: plugin.id, enabled },
        crypto.randomUUID(),
      )
      .then((result) => {
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        setPlugins(result.outcome.plugins ?? []);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not change the plugin."),
      )
      .finally(() => setBusy(null));
  };
  return (
    <section aria-label={`${provider.label} plugins`} className="space-y-2">
      <h3 className="text-sm font-medium">{provider.label}</h3>
      <SettingsCard className="divide-y">
        {!plugins && !error && (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            Loading plugins…
          </p>
        )}
        {plugins?.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            No plugins yet. {INSTALL_HINTS[provider.id]}
          </p>
        )}
        {plugins?.map((plugin) => (
          <label
            key={plugin.id}
            data-plugin={plugin.id}
            className="flex items-start gap-3 p-4 has-[:disabled]:cursor-default"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{plugin.name}</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {[plugin.marketplace, plugin.version && `v${plugin.version}`]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {plugin.description && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {plugin.description}
                </span>
              )}
              {!plugin.canToggle && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  Set by a project or your organization, so it is changed there.
                </span>
              )}
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label={plugin.name}
              checked={plugin.enabled}
              disabled={!plugin.canToggle || busy !== null}
              onChange={(event) => toggle(plugin, event.target.checked)}
              className="mt-1 size-4 shrink-0 accent-primary"
            />
          </label>
        ))}
      </SettingsCard>
      {plugins && plugins.length > 0 && (
        <p className="text-xs text-muted-foreground">{INSTALL_HINTS[provider.id]}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
