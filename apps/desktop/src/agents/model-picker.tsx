import { useContext, useState } from "react";
import { modelMenu, modelOptions } from "@concors/client-core";
import { Download, LoaderCircle } from "lucide-react";
import {
  agentProviderName,
  PROVIDER_SUBSCRIPTIONS_CAPABILITY,
  type AgentAccount,
  type AgentInfo,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { AccountConnectDialog } from "./account-connect-dialog";
import { accountName, presetEngine } from "./account-name";
import { requestAccount } from "./account-requests";
import { ProviderAccountFooter } from "./provider-account-footer";
import { ControlPicker } from "./control-picker";
import { ProviderIcon } from "./provider-icon";
import { useAgentModelSelection } from "./use-model-selection";
import { ProviderUpdateFooter, ProviderUpdateNotice } from "./provider-update";
import { useProviderUpdate } from "./provider-update-state";
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
  const connection = useContext(TerminalConnectionContext);
  // Whether a provider is signed in, asked when its page of the menu opens rather than up front:
  // each check runs its CLI. Without an answer there is no evidence either way, so no footer.
  const [accounts, setAccounts] = useState<Record<string, AgentAccount>>({});
  const [connecting, setConnecting] = useState<{
    id: string;
    label: string;
    engine: string | undefined;
  } | null>(null);
  const engineOf = (id: string) =>
    id === agent.provider ? (agent.engine ?? agent.provider) : presetEngine(id);
  const readAccount = (id: string) => {
    if (
      connection?.state.status !== "ready" ||
      !connection.state.daemon.capabilities?.includes(PROVIDER_SUBSCRIPTIONS_CAPABILITY)
    )
      return;
    void requestAccount(connection, id, { type: "read" }).then(
      (account) => setAccounts((known) => ({ ...known, [id]: account })),
      () =>
        setAccounts((known) => {
          const { [id]: _forgotten, ...rest } = known;
          return rest;
        }),
    );
  };
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
          description:
            p.installed === false
              ? "Not installed on this machine"
              : `${switchDescription(agents, agent, p.id)}${p.version?.updateAvailable ? `. Update available (${p.version.latest})` : ""}`,
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
                      setConnecting({
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
        onSelect={(value, provider) => {
          if (provider && provider !== agent.provider && hasConversation(agent))
            setConfirming({ model: value, provider });
          else void choose(value, provider);
        }}
      />
      {connecting && connection && (
        <AccountConnectDialog
          connection={connection}
          provider={connecting}
          startRightAway
          onChanged={() => readAccount(connecting.id)}
          onClose={() => {
            readAccount(connecting.id);
            setConnecting(null);
          }}
        />
      )}
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
