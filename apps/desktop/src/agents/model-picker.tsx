import { useContext, useState } from "react";
import { LoaderCircle } from "lucide-react";
import {
  AgentProviderIdSchema,
  agentProviderNames,
  type AgentInfo,
  type AgentProviderCatalog,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { ControlPicker } from "./control-picker";
import { ProviderIcon } from "./provider-icon";

export function AgentModelPicker({
  agent,
  disabled,
  onSelect,
}: {
  agent: AgentInfo;
  disabled: boolean;
  onSelect: (model: string | null) => void;
}) {
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
  return (
    <>
      <ControlPicker
        label="Agent and model"
        showValue
        selectedLabel={
          currentModels.find((m) => m.id === model)?.label ?? model ?? "Machine default"
        }
        value={agent.settings?.model ?? ""}
        icon={
          agent.status === "starting" || switching ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <ProviderIcon provider={agent.provider} />
          )
        }
        disabled={disabled || agent.status === "starting" || switching}
        options={[]}
        selectedGroupId={agent.provider}
        onOpen={() => void load()}
        status={loading ? "Loading providers…" : undefined}
        groups={providers.map((p) => ({
          id: p.id,
          label: agentProviderNames[p.id],
          description: p.id === agent.provider ? "Current conversation" : "Starts a new chat",
          icon: <ProviderIcon provider={p.id} />,
          emptyMessage: p.error,
          options: p.error
            ? []
            : [
                {
                  id: "",
                  label: "Machine default",
                  description:
                    p.id === agent.provider
                      ? (agent.model ?? "Use the provider’s default model")
                      : "Start a new conversation with this provider",
                  icon: <ProviderIcon provider={p.id} />,
                },
                ...p.models.map((m) => ({
                  id: m.id,
                  label: m.label,
                  icon: <ProviderIcon provider={p.id} />,
                })),
              ],
        }))}
        onSelect={(value, provider) => void choose(value, provider)}
      />
      {error && (
        <p role="alert" className="w-full px-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
