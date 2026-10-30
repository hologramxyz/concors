import { useState } from "react";
import { modelOptions } from "@concors/client-core";
import { CircleArrowUp, Download, ExternalLink, LoaderCircle } from "lucide-react";
import { agentProviderName, providerPresets, type AgentInfo } from "@concors/protocol";
import { ControlPicker } from "./control-picker";
import { ProviderIcon } from "./provider-icon";
import { useAgentModelSelection } from "./use-model-selection";
import { ProviderUpdateNotice } from "./provider-update";
import { providerUpdatePending, useProviderUpdate } from "./provider-update-state";
import { useAgents } from "./context";
import { hasConversation, switchConfirmation, switchDescription } from "./provider-switch";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/tauri/open-external";
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
  const current = providers.find((p) => p.id === agent.provider);
  const providerLabel = current?.label ?? agentProviderName(agent.provider);
  const {
    version,
    error: updateError,
    update,
  } = useProviderUpdate(agent.provider, providerLabel, current?.version);
  const [guideError, setGuideError] = useState<string | null>(null);
  // Without an update command the CLI was installed some way the daemon cannot repeat, so the
  // item opens the vendor's guide instead.
  const guide = providerPresets.find((p) => p.id === (agent.engine ?? agent.provider))?.installLink;
  const updateAction = version && providerUpdatePending(version) && (
    <>
      <button
        type="button"
        disabled={!!version.updating || (!version.updateCommand && !guide)}
        onClick={() => {
          setGuideError(null);
          if (version.updateCommand) void update();
          else if (guide)
            void openExternal(guide).catch(() => setGuideError("Could not open the update guide."));
        }}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-accent disabled:hover:bg-transparent"
      >
        {version.updating ? (
          <LoaderCircle className="size-4 shrink-0 animate-spin" />
        ) : (
          <CircleArrowUp className="size-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            {version.updating ? `Updating ${providerLabel}…` : `Update ${providerLabel}`}
          </span>
          {version.latest && (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {version.updateCommand
                ? `${version.installed ?? "Installed"} → ${version.latest}`
                : `${version.latest} is out. Update it the way you installed it.`}
            </span>
          )}
        </span>
        {!version.updateCommand && guide && (
          <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>
      {(updateError ?? guideError) && (
        <p role="alert" className="px-2 pb-1 text-xs text-destructive">
          {updateError ?? guideError}
        </p>
      )}
    </>
  );
  return (
    <>
      <ControlPicker
        label="Agent and model"
        notice={
          version?.updating
            ? `Updating ${providerLabel}`
            : version?.updateAvailable
              ? `${providerLabel} ${version.latest} available`
              : undefined
        }
        action={updateAction}
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
          // The selected agent's update is the menu's first item instead.
          footer: p.id !== agent.provider && p.version && (
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
