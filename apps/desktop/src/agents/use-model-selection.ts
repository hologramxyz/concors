import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ProviderCatalogCache, providerCatalogCache } from "./provider-catalog-cache";
import { AgentStartedContext } from "./context";
import {
  AgentProviderIdSchema,
  type AgentInfo,
  type AgentProviderCatalog,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";

export function useAgentModelSelection(
  agent: AgentInfo,
  onSelect: (model: string | null) => void,
  enabled = true,
) {
  const connection = useContext(TerminalConnectionContext);
  const onStarted = useContext(AgentStartedContext);
  const cache = useMemo(
    () =>
      connection ? providerCatalogCache(connection, agent.directory) : new ProviderCatalogCache(),
    [connection, agent.directory],
  );
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [connection, agent.id, cache],
  );
  const catalog = useSyncExternalStore(cache.subscribe, cache.getSnapshot);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null),
    [switching, setSwitching] = useState(false),
    [error, setError] = useState<string | null>(null);
  const cachedCurrent = catalog.find((p) => p.id === agent.provider);
  const currentModels = agent.models?.length ? agent.models : (cachedCurrent?.models ?? []);
  const current: AgentProviderCatalog = {
    ...cachedCurrent,
    id: agent.provider,
    models: currentModels,
  };
  const providers = catalog.some((p) => p.id === agent.provider)
    ? catalog.map((p) => (p.id === agent.provider ? current : p))
    : [current, ...catalog];
  const model = agent.settings?.model ?? agent.model;
  const load = async (provider = agent.provider) => {
    if (
      !enabled ||
      !connection ||
      !connection.state ||
      connection.state.status !== "ready" ||
      !connection.state.daemon.capabilities?.includes("agent-providers")
    )
      return;
    const attempt = generation.current;
    setLoadingProvider(provider);
    setError(null);
    try {
      await cache.load(provider, async () => {
        const result = await connection.requestAgent(
          { kind: "provider-catalog", sessionId: agent.id, provider },
          crypto.randomUUID(),
        );
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        return result.outcome.providers ?? [];
      });
    } catch (e) {
      if (attempt === generation.current)
        setError(e instanceof Error ? e.message : "Could not load providers");
    } finally {
      if (attempt === generation.current)
        setLoadingProvider((current) => (current === provider ? null : current));
    }
  };
  useEffect(() => {
    if (!enabled) return;
    // Warm only the current provider, not a process for every installed CLI.
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60000);
    const unsubscribe = connection?.subscribe((state) => {
      if (state.status === "ready") refresh();
    });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      unsubscribe?.();
    };
    // The request uses this conversation's identity; agent revision updates must not trigger discovery loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, agent.id, agent.provider, cache, enabled]);
  const choose = async (next: string, id?: string) => {
    const provider = AgentProviderIdSchema.parse(id ?? agent.provider);
    if (provider === agent.provider) {
      onSelect(next || null);
      return;
    }
    if (!connection) return;
    const attempt = generation.current;
    setSwitching(true);
    setError(null);
    try {
      const result = await connection.requestAgent(
        {
          kind: "switch-provider",
          sessionId: agent.id,
          provider,
          model: next || null,
          expectedRevision: agent.revision,
        },
        crypto.randomUUID(),
      );
      // A late switch must not navigate a different pane, account or machine.
      if (attempt !== generation.current) return;
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      onStarted?.(result.outcome.conversation.agent.id);
    } catch (e) {
      if (attempt === generation.current)
        setError(e instanceof Error ? e.message : "Could not start provider");
    } finally {
      // Always release this hook's busy state if its connection was replaced.
      setSwitching(false);
    }
  };
  return { currentModels, model, providers, load, choose, loadingProvider, switching, error };
}
