import { useCallback, useContext, useEffect, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import type { DaemonConnection } from "@concors/daemon-client";
import type { AgentAccount, ProviderStatus } from "@concors/protocol";
import { AccountConnectDialog } from "@/agents/account-connect-dialog";
import { accountChanges, requestAccount } from "@/agents/account-requests";
import { ProviderIcon } from "@/agents/provider-icon";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/tauri/open-external";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { StepFrame, WaitingForMachine } from "./frame";
import { agentReadiness, type AgentReadiness } from "./model";

/** The agents setup offers, in the order it lists them. */
const AGENTS = ["claude", "codex", "opencode"] as const;
const HINTS: Record<string, string> = {
  claude: "Uses your Claude Pro or Max plan, or an Anthropic API key.",
  codex: "Uses your ChatGPT Plus or Pro plan, or an OpenAI API key.",
  opencode: "Open source. Works with many model providers.",
};
/** How often the list is read again while an install runs, as the terminal's install offer does. */
const INSTALL_POLL_MS = 2_000;

/** Second step: the agent CLIs on the chosen machine, installed and signed in from here. */
export function AgentsStep({
  banner,
  onBack,
  onNext,
  onSkip,
}: {
  banner?: React.ReactNode;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const ready = connection?.state.status === "ready" ? connection : null;
  const agents = useAgentStatuses(ready);
  const readyCount = agents.rows.filter((row) => row.readiness === "ready").length;
  return (
    <StepFrame
      step={1}
      title="Your agents"
      description="Install the coding agents you use and sign in with your own plan. Concors never charges for the AI itself."
      banner={banner}
      primary={{
        label: readyCount || !ready ? "Continue" : "Continue without an agent",
        onClick: onNext,
      }}
      onBack={onBack}
      onSkip={onSkip}
    >
      {!ready ? (
        <WaitingForMachine />
      ) : agents.error && !agents.rows.length ? (
        <p role="alert" className="text-sm text-destructive">
          {agents.error}
        </p>
      ) : !agents.rows.length ? (
        <p role="status" className="text-sm text-muted-foreground">
          Checking which agents are installed…
        </p>
      ) : (
        <>
          <ul aria-label="Agents" className="divide-y rounded-xl border">
            {agents.rows.map((row) => (
              <AgentRow
                key={row.provider.id}
                row={row}
                onInstall={() => agents.install(row.provider.id)}
                onSignIn={() => agents.setSigningIn(row.provider)}
              />
            ))}
          </ul>
          {agents.error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {agents.error}
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            One ready agent is enough to start. You can add the others later.
          </p>
        </>
      )}
      {ready && agents.signingIn && (
        <AccountConnectDialog
          connection={ready}
          provider={agents.signingIn}
          startRightAway
          onChanged={agents.refresh}
          onClose={() => {
            agents.setSigningIn(null);
            agents.refresh();
          }}
        />
      )}
    </StepFrame>
  );
}

interface Row {
  provider: ProviderStatus;
  readiness: AgentReadiness;
  account: AgentAccount | null | undefined;
}

function AgentRow({
  row,
  onInstall,
  onSignIn,
}: {
  row: Row;
  onInstall: () => void;
  onSignIn: () => void;
}) {
  const { provider, readiness, account } = row;
  const hint =
    readiness === "ready" && account?.label
      ? `Signed in as ${account.label}`
      : readiness === "missing" && provider.installStatus === "failed"
        ? (provider.error ?? "The install failed. Try again.")
        : (HINTS[provider.id] ?? "");
  return (
    <li
      aria-label={provider.label}
      data-agent-readiness={readiness}
      className="flex items-center gap-3.5 px-4 py-3.5"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <ProviderIcon provider={provider.id} size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{provider.label}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      {readiness === "ready" ? (
        <span className="flex items-center gap-1 rounded-full bg-emerald-600/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          <Check className="size-3" aria-hidden="true" />
          Ready
        </span>
      ) : readiness === "installing" || readiness === "checking" ? (
        <span role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          {readiness === "installing" ? "Installing…" : "Checking…"}
        </span>
      ) : readiness === "sign-in" ? (
        <Button size="sm" variant="outline" onClick={onSignIn}>
          Sign in
        </Button>
      ) : provider.canInstall ? (
        <Button size="sm" variant="outline" onClick={onInstall}>
          Install
        </Button>
      ) : provider.installLink ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void openExternal(provider.installLink ?? "").catch(() => undefined)}
        >
          How to install
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">Not installed</span>
      )}
    </li>
  );
}

/** The offered agents on this machine and their accounts, read again while an install runs. */
function useAgentStatuses(connection: DaemonConnection | null) {
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [accounts, setAccounts] = useState<Record<string, AgentAccount | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState<ProviderStatus | null>(null);
  const [reads, setReads] = useState(0);
  const refresh = useCallback(() => setReads((value) => value + 1), []);
  const canAccount =
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes("agent-accounts");
  useEffect(() => {
    if (!connection) return;
    let current = true;
    void connection
      .requestProvider({ kind: "list" }, crypto.randomUUID())
      .then(async (result) => {
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        const offered = AGENTS.flatMap((id) => {
          const found = result.outcome.status === "ok" ? result.outcome.providers : [];
          const provider = found.find((p) => p.id === id && !p.subscription);
          return provider ? [provider] : [];
        });
        if (!current) return;
        setProviders(offered);
        setError(null);
        if (!canAccount) return;
        for (const provider of offered.filter((p) => p.installed))
          void requestAccount(connection, provider.id, { type: "read" }).then(
            (account) => current && setAccounts((all) => ({ ...all, [provider.id]: account })),
            () => current && setAccounts((all) => ({ ...all, [provider.id]: null })),
          );
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : "Could not read agents");
      });
    return () => {
      current = false;
    };
  }, [connection, canAccount, reads]);
  // While one installs, the list is read again until it is done; a connected account anywhere
  // (the model menu, Settings) shows here too.
  const installing = providers?.some((p) => p.installStatus === "installing") ?? false;
  useEffect(() => {
    if (!installing) return;
    const timer = setInterval(refresh, INSTALL_POLL_MS);
    return () => clearInterval(timer);
  }, [installing, refresh]);
  useEffect(() => {
    accountChanges.addEventListener("change", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      accountChanges.removeEventListener("change", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);
  const install = (id: string) => {
    if (!connection) return;
    setProviders(
      (all) => all?.map((p) => (p.id === id ? { ...p, installStatus: "installing" } : p)) ?? all,
    );
    void connection
      .requestProvider({ kind: "install", id }, crypto.randomUUID())
      .then((result) => {
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        refresh();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not install");
        refresh();
      });
  };
  const rows: Row[] = (providers ?? []).map((provider) => {
    const account = canAccount ? accounts[provider.id] : null;
    return { provider, account, readiness: agentReadiness(provider, account, canAccount) };
  });
  return { rows, error, install, refresh, signingIn, setSigningIn };
}
