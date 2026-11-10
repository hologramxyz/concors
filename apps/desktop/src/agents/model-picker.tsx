import { modelMenu, modelOptions } from "@concors/client-core";
import { Download, LoaderCircle } from "lucide-react";
import { agentProviderName, type AgentInfo } from "@concors/protocol";
import { accountName } from "./account-name";
import { useModelMenuActions } from "./model-menu-actions";
import { ProviderAccountFooter } from "./provider-account-footer";
import { ControlPicker } from "./control-picker";
import { ProviderIcon } from "./provider-icon";
import { useAgentModelSelection } from "./use-model-selection";
import { ProviderUpdateFooter, ProviderUpdateNotice } from "./provider-update";
import { useProviderUpdate } from "./provider-update-state";
import { isNewChatStarting } from "./context";
import { providerState } from "./provider-switch";

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
  const {
    accounts,
    readAccount,
    engineOf,
    connect,
    choose: chooseModel,
    dialogs,
  } = useModelMenuActions(agent, providers, choose);
  const current = providers.find((p) => p.id === agent.provider);
  const providerLabel = current?.label ?? agentProviderName(agent.provider);
  const {
    version,
    error: updateError,
    update,
  } = useProviderUpdate(agent.provider, providerLabel, current?.version);
  return (
    <>
      <ControlPicker
        label="Agent and model"
        mobileDrawer
        notice={
          version?.updating
            ? `Updating ${providerLabel}`
            : version?.updateAvailable
              ? `${providerLabel} ${version.latest} available`
              : undefined
        }
        showValue={showValue}
        primary
        selectedLabel={selection.label}
        value={selection.value}
        icon={
          (agent.status === "starting" && !isNewChatStarting(agent)) || switching ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <ProviderIcon provider={agent.provider} />
          )
        }
        disabled={disabled || agent.status === "starting" || switching}
        options={[]}
        selectedGroupId={agent.provider}
        onOpen={() => {
          void load();
          readAccount(agent.provider);
        }}
        onGroupChange={(id) => {
          void load(id);
          readAccount(id);
        }}
        groups={providers.map((p) => ({
          id: p.id,
          label: p.label ?? agentProviderName(p.id),
          description: providerState(p),
          icon: <ProviderIcon provider={p.id} />,
          emptyMessage:
            p.error ??
            (p.loaded
              ? "No models reported. Check this provider in Settings."
              : "Models are being discovered. They will appear here automatically."),
          status: p.error,
          // The selected agent's update is run from here, so it outlives the menu and the chip's
          // dot follows its progress.
          footer: (
            <>
              {p.id === agent.provider ? (
                <ProviderUpdateFooter
                  provider={agent.engine ?? agent.provider}
                  label={providerLabel}
                  version={version}
                  error={updateError}
                  onUpdate={() => void update()}
                />
              ) : (
                p.version && (
                  <ProviderUpdateNotice
                    id={p.id}
                    provider={p.id}
                    label={p.label ?? agentProviderName(p.id)}
                    version={p.version}
                  />
                )
              )}
              {p.installed !== false &&
                (accounts[p.id]?.status === "disconnected" ||
                  accounts[p.id]?.status === "pending") && (
                  <ProviderAccountFooter
                    account={accountName(engineOf(p.id), p.label ?? agentProviderName(p.id))}
                    onConnect={() =>
                      connect({
                        id: p.id,
                        label: p.label ?? agentProviderName(p.id),
                        engine: engineOf(p.id),
                      })
                    }
                  />
                )}
            </>
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
            // The header already shows the agent, so model rows carry no icon of their own.
            ...modelMenu(p.id === agent.provider ? selection.options : modelOptions(p.models)).map(
              (m) => ({ id: m.id, label: m.label, older: m.older }),
            ),
          ],
        }))}
        onSelect={chooseModel}
      />
      {dialogs}
      {error && (
        <p role="alert" className="w-full px-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
