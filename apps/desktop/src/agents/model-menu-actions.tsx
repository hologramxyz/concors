import { useContext, useState } from "react";
import {
  agentProviderName,
  PROVIDER_SUBSCRIPTIONS_CAPABILITY,
  type AgentAccount,
  type AgentInfo,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AccountConnectDialog } from "./account-connect-dialog";
import { presetEngine } from "./account-name";
import { requestAccount } from "./account-requests";
import { useAgents } from "./context";
import { hasConversation, switchConfirmation } from "./provider-switch";

/**
 * What the desktop menu and the iPhone's native one do beside listing models: ask which providers
 * are signed in, connect one, and confirm a switch that would set a conversation with content
 * aside. Both render `dialogs`.
 */
export function useModelMenuActions(
  agent: AgentInfo,
  providers: readonly { id: string; label?: string | undefined }[],
  choose: (model: string, provider?: string) => unknown,
) {
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
  return {
    accounts,
    readAccount,
    engineOf,
    connect: setConnecting,
    choose: (model: string, provider?: string) => {
      if (provider && provider !== agent.provider && hasConversation(agent))
        setConfirming({ model, provider });
      else void choose(model, provider);
    },
    dialogs: (
      <>
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
      </>
    ),
  };
}
