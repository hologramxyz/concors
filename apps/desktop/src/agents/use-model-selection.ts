import { useContext, useState } from "react";
import {
  AgentProviderIdSchema,
  type AgentInfo,
  type AgentProviderCatalog,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";

export function useAgentModelSelection(agent: AgentInfo, onSelect: (model: string | null) => void) {
  const connection = useContext(TerminalConnectionContext);
  const [catalog, setCatalog] = useState<AgentProviderCatalog[]>([]);
  const [loading, setLoading] = useState(false),
    [switching, setSwitching] = useState(false),
    [error, setError] = useState<string | null>(null);
  const currentModels = agent.models ?? [];
  const current: AgentProviderCatalog = { id: agent.provider, models: currentModels };
  const providers = catalog.some((p) => p.id === agent.provider)
    ? catalog.map((p) => (p.id === agent.provider ? current : p))
    : [current, ...catalog];
  const model = agent.settings?.model ?? agent.model;
  const load = async () => {
    if (
      !connection ||
      loading ||
      !connection.state ||
      connection.state.status !== "ready" ||
      !connection.state.daemon.capabilities?.includes("agent-providers")
    )
      return;
    setLoading(true);
    setError(null);
    try {
      const result = await connection.requestAgent(
        { kind: "provider-catalog", sessionId: agent.id },
        crypto.randomUUID(),
      );
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      setCatalog(result.outcome.providers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load providers");
    } finally {
      setLoading(false);
    }
  };
  const choose = async (next: string, id?: string) => {
    const provider = AgentProviderIdSchema.parse(id ?? agent.provider);
    if (provider === agent.provider) {
      onSelect(next || null);
      return;
    }
    if (!connection) return;
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
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start provider");
    } finally {
      setSwitching(false);
    }
  };
  return { currentModels, model, providers, load, choose, loading, switching, error };
}
