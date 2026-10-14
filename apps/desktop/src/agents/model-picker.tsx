import { useState } from "react";
import { modelOptions } from "@concors/client-core";
import { Download, LoaderCircle } from "lucide-react";
import { agentProviderName, type AgentInfo } from "@concors/protocol";
import { ControlPicker } from "./control-picker";
import { ProviderIcon } from "./provider-icon";
import { useAgentModelSelection } from "./use-model-selection";
import { ProviderUpdateNotice } from "./provider-update";
import { useAgents } from "./context";
import { hasConversation, switchConfirmation, switchDescription } from "./provider-switch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function AgentModelPicker({
  agent,
  disabled,
  onSelect,
  showValue = true,
}: {
  agent: AgentInfo;
  disabled: boolean;
  showValue?: boolean;
  onSelect: (model: string | null) => void;
}) {
  const { selection, providers, load, choose, switching, error } = useAgentModelSelection(
    agent,
    onSelect,
    !disabled && agent.status !== "starting",
  );
  const agents = useAgents();
  // A switch that would set a conversation with content aside is confirmed first.
  const [confirming, setConfirming] = useState<{ model: string; provider: string } | null>(null);
  const confirmation =
    confirming &&
    switchConfirmation(
      agents,
      agent,
      confirming.provider,
      providers.find((p) => p.id === confirming.provider)?.label ??
        agentProviderName(confirming.provider),
    );
  return (
    <>
      <ControlPicker
        label="Agent and model"
        showValue={showValue}
        primary
        selectedLabel={selection.label}
        value={selection.value}
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
        onGroupChange={(id) => void load(id)}
        groups={providers.map((p) => ({
          id: p.id,
          label: p.label ?? agentProviderName(p.id),
          description:
            p.installed === false
              ? "Not installed on this machine"
              : `${switchDescription(agents, agent, p.id)}${p.version?.updateAvailable ? ` · Update available (${p.version.latest})` : ""}`,
          icon: <ProviderIcon provider={p.id} />,
          emptyMessage:
            p.error ??
            (p.loaded
              ? "No models reported. Check this provider in Settings."
              : "Models are being discovered. They will appear here automatically."),
          status: p.error,
          footer: p.version && (
            <ProviderUpdateNotice
              provider={p.id}
              label={p.label ?? agentProviderName(p.id)}
              version={p.version}
            />
          ),
          options: [
            // An empty catalog must still allow opening a provider to sign in, and a missing
            // CLI to be installed: the chat it opens offers the install.
            ...(!p.models.length
              ? [
                  {
                    id: "",
                    label: `${p.installed === false ? "Install" : "Use"} ${p.label ?? agentProviderName(p.id)}`,
                    icon:
                      p.installed === false ? (
                        <Download className="size-4" />
                      ) : (
                        <ProviderIcon provider={p.id} />
                      ),
                  },
                ]
              : []),
            ...(p.id === agent.provider ? selection.options : modelOptions(p.models)).map((m) => ({
              id: m.id,
              label: m.label,
              icon: <ProviderIcon provider={p.id} />,
            })),
          ],
        }))}
        onSelect={(value, provider) => {
          if (provider && provider !== agent.provider && hasConversation(agent))
            setConfirming({ model: value, provider });
          else void choose(value, provider);
        }}
      />
      <Dialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        {confirmation && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirmation.title}</DialogTitle>
              <DialogDescription>{confirmation.description}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (confirming) void choose(confirming.model, confirming.provider);
                  setConfirming(null);
                }}
              >
                {confirmation.action}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
      {error && (
        <p role="alert" className="w-full px-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
