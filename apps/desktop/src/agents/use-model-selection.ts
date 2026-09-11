import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AgentStartedContext } from "./context";
import { AgentProviderIdSchema, type AgentInfo } from "@concors/protocol";
import { modelSelection } from "@concors/client-core";
import { modelCatalog } from "./model-catalog";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { PaneVisibilityContext } from "@/components/compact-layout";
import { useTabVisible } from "@/workspace/tab-visibility";

const empty = { providers: [], pending: [], error: null };
const emptySnapshot = () => empty;
const emptySubscribe = () => () => undefined;

export function useAgentModelSelection(agent: AgentInfo, onSelect: (model: string | null) => void) {
  const connection = useContext(TerminalConnectionContext);
  const paneVisible = useContext(PaneVisibilityContext);
  const tabVisible = useTabVisible();
  const onStarted = useContext(AgentStartedContext);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [connection, agent.id],
  );
  const epoch = connection?.workspace?.epoch;
  const cache = useMemo(
    () => (connection ? modelCatalog(connection, agent.directory, epoch) : null),
    [connection, agent.directory, epoch],
  );
  const snapshot = useSyncExternalStore(
    cache?.subscribe ?? emptySubscribe,
    cache?.getSnapshot ?? emptySnapshot,
  );
  const [switching, setSwitching] = useState(false),
    [error, setError] = useState<string | null>(null);
  const known = snapshot.providers.find((p) => p.id === agent.provider);
  const currentModels = agent.models?.length ? agent.models : (known?.models ?? []);
  const current = {
    ...known,
    id: agent.provider,
    label: agent.providerLabel ?? known?.label,
    models: currentModels,
    loaded: known?.loaded || !!currentModels.length,
  };
  const providers = known
    ? snapshot.providers.map((p) => (p.id === agent.provider ? current : p))
    : [current, ...snapshot.providers];
  const selection = modelSelection(agent, currentModels);
  const load = (provider?: string) => cache?.load(agent, provider) ?? Promise.resolve();
  const ready =
    paneVisible &&
    tabVisible &&
    agent.status !== "starting" &&
    !!agent.threadId &&
    connection?.state.status === "ready";
  useEffect(() => {
    if (cache && ready) void cache.warm(agent);
    // The shared cache coalesces both native/web composers and keeps menus warm across panes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, agent.id, ready]);
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
  return {
    currentModels,
    selection,
    providers,
    load,
    choose,
    pending: snapshot.pending,
    switching,
    error: error ?? snapshot.error,
  };
}
