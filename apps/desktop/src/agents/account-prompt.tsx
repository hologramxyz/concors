import { PaneVisibilityContext } from "@/components/compact-layout";
import { copyText } from "@/lib/clipboard";
import { useTabVisible } from "@/workspace/tab-visibility";
import type { DaemonConnection } from "@concors/daemon-client";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Check, Copy, Download, ExternalLink, LoaderCircle, X } from "lucide-react";
import {
  agentProviderName,
  type AgentAccount,
  type AgentAccountAction,
  type AgentInfo,
  type ProviderOperation,
  type ProviderStatus,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { openExternal } from "@/tauri/open-external";
import { invalidateModelCatalogs } from "./model-catalog";

import { Button } from "@/components/ui/button";
function dismissed(key: string) {
  try {
    return sessionStorage.getItem(key) === "dismissed";
  } catch {
    return false;
  }
}
export function AgentAccountPrompt({ agent, canEdit }: { agent: AgentInfo; canEdit: boolean }) {
  const connection = useContext(TerminalConnectionContext);
  const paneVisible = useContext(PaneVisibilityContext);
  const tabVisible = useTabVisible();
  if (
    !paneVisible ||
    !tabVisible ||
    !connection ||
    connection.state.status !== "ready" ||
    !connection.state.daemon.capabilities?.includes("agent-accounts") ||
    !["codex", "claude", "opencode"].includes(agent.engine ?? agent.provider)
  )
    return null;
  return (
    <AccountPrompt
      key={`${connection.endpoint.url}:${agent.id}`}
      agent={agent}
      canEdit={canEdit}
      connection={connection}
    />
  );
}
function AccountPrompt({
  agent,
  canEdit,
  connection,
}: {
  agent: AgentInfo;
  canEdit: boolean;
  connection: DaemonConnection;
}) {
  const storageKey = `concors:account-prompt:${connection.endpoint.url}:${agent.provider}`;
  const [hidden, setHidden] = useState(() => dismissed(storageKey));
  const [account, setAccount] = useState<AgentAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState("");
  const [value, setValue] = useState("");
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);
  const isDismissed = useRef(hidden);
  const pending = useRef<Promise<void> | null>(null);
  const latest = useRef<AgentAccount | null>(null);
  // Signing in needs the CLI, so a failed account check asks whether it is installed, and a
  // machine without it is offered the install instead. Undefined until a failure asks; null when
  // the daemon can't say. Only failures ask: listing providers holds up the daemon briefly.
  const checksInstall = !!(
    connection.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes("provider-settings")
  );
  const [cli, setCli] = useState<ProviderStatus | null | undefined>(
    checksInstall ? undefined : null,
  );
  const [installError, setInstallError] = useState<string | null>(null);
  const latestCli = useRef(cli);
  const failed = useRef(agent.status === "failed");
  useEffect(() => {
    failed.current = agent.status === "failed";
  }, [agent.status]);
  const request = useCallback(
    async (action: AgentAccountAction, background = false) => {
      if (pending.current && action.type === "read") return;
      // A focus refresh must not disable a button between pointerdown and click,
      // or discard the user's action while that read is in flight.
      while (pending.current) {
        setBusy(true);
        await pending.current;
        if (!mounted.current || (isDismissed.current && action.type !== "cancel")) {
          if (mounted.current) setBusy(false);
          return;
        }
      }
      let complete!: () => void;
      pending.current = new Promise<void>((resolve) => {
        complete = resolve;
      });
      if (!background) setBusy(true);
      setError(null);
      try {
        const result = await connection.requestAgent(
          { kind: "account", sessionId: agent.id, action },
          crypto.randomUUID(),
        );
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        const next = result.outcome.account;
        if (!next) throw new Error("This machine needs a daemon update to connect accounts here.");
        if (!mounted.current || isDismissed.current) {
          if (next.challenge)
            void connection
              .requestAgent(
                {
                  kind: "account",
                  sessionId: agent.id,
                  action: { type: "cancel", flowId: next.challenge.flowId },
                },
                crypto.randomUUID(),
              )
              .catch(() => undefined);
          return;
        }
        if (
          action.type === "read" &&
          latest.current?.status === "pending" &&
          next.status === "disconnected" &&
          !next.message
        )
          next.message = "Sign-in expired or was cancelled. Try again.";
        if (next.status === "connected" && latest.current && latest.current.status !== "connected")
          invalidateModelCatalogs(connection);
        latest.current = next;
        setAccount(next);
        if (action.type === "complete" || next.status === "connected") setValue("");
      } catch (cause) {
        if (mounted.current && !isDismissed.current)
          setError(cause instanceof Error ? cause.message : "Could not connect account");
      } finally {
        pending.current = null;
        complete();
        if (mounted.current) {
          setBusy(false);
          if (action.type === "complete") setValue("");
        }
      }
    },
    [connection, agent.id],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const challenge = latest.current?.challenge;
      if (challenge)
        void connection
          .requestAgent(
            {
              kind: "account",
              sessionId: agent.id,
              action: { type: "cancel", flowId: challenge.flowId },
            },
            crypto.randomUUID(),
          )
          .catch(() => undefined);
    };
  }, [connection, agent.id]);
  const provider = useCallback(
    async (operation: ProviderOperation) => {
      const result = await connection.requestProvider(operation, crypto.randomUUID());
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      const next =
        result.outcome.providers.find((p) => p.id === (agent.engine ?? agent.provider)) ?? null;
      const before = latestCli.current;
      latestCli.current = next;
      if (!mounted.current) return;
      setCli(next);
      if (before && !before.installed && next?.installed) {
        setInstallError(null);
        invalidateModelCatalogs(connection);
        void request({ type: "read" });
        // The chat failed to start without the CLI; resuming clears that error and
        // delivers anything that was queued meanwhile.
        if (failed.current)
          void connection
            .requestAgent(
              { kind: "queue-pause", sessionId: agent.id, paused: false },
              crypto.randomUUID(),
            )
            .catch(() => undefined);
      }
    },
    [connection, agent.id, agent.engine, agent.provider, request],
  );
  const listing = useRef(false);
  const checkInstall = useCallback(() => {
    if (!checksInstall || listing.current) return;
    listing.current = true;
    void provider({ kind: "list" })
      .catch(() => {
        // Without an answer, fall back to the account check alone.
        if (latestCli.current !== undefined || !mounted.current) return;
        latestCli.current = null;
        setCli(null);
      })
      .finally(() => {
        listing.current = false;
      });
  }, [checksInstall, provider]);
  useEffect(() => {
    if (error && cli === undefined) checkInstall();
  }, [error, cli, checkInstall]);
  const installing = cli?.installStatus === "installing";
  useEffect(() => {
    if (hidden || !installing) return;
    const timer = setInterval(checkInstall, 2000);
    return () => clearInterval(timer);
  }, [hidden, installing, checkInstall]);
  useEffect(() => {
    if (hidden || !canEdit) return;
    void Promise.resolve().then(() => {
      if (mounted.current && !isDismissed.current) void request({ type: "read" });
    });
    const check = () => {
      if (latestCli.current?.installed === false) checkInstall();
      if (!latest.current?.challenge) void request({ type: "read" }, true);
    };
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [hidden, canEdit, request, checkInstall]);
  useEffect(() => {
    if (hidden || account?.status !== "pending") return;
    const timer = setInterval(() => void request({ type: "read" }), 2000);
    return () => clearInterval(timer);
  }, [hidden, account?.status, request]);
  const hide = () => {
    // A dismissal cancels an unfinished sign-in; it never signs out an existing account.
    const challenge = latest.current?.challenge;
    if (challenge) void request({ type: "cancel", flowId: challenge.flowId });
    setValue("");
    isDismissed.current = true;
    setHidden(true);
    try {
      sessionStorage.setItem(storageKey, "dismissed");
    } catch {
      /* In-memory dismissal still works. */
    }
  };
  if (!canEdit) return null;
  if (hidden)
    return (
      <Button
        variant="ghost"
        className="text-muted-foreground"
        onClick={() => {
          isDismissed.current = false;
          setHidden(false);
          try {
            sessionStorage.removeItem(storageKey);
          } catch {
            /* Optional browser storage. */
          }
        }}
      >
        Connect account
      </Button>
    );
  // A failed check may only mean the CLI is missing; wait to know before showing it.
  if (cli === undefined && error) return null;
  const label = agent.providerLabel ?? agentProviderName(agent.provider);
  if (cli && !cli.installed) {
    const failure = installError ?? (cli.installStatus === "failed" ? cli.error : undefined);
    return (
      <section
        aria-label={`${label} installation`}
        className="rounded-xl border bg-muted/30 p-3 text-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">Install {cli.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {cli.canInstall
                ? `Concors can install ${cli.label} on this machine for you. It takes about a minute.`
                : `Install ${cli.label} on this machine using its guide, then come back here.`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            aria-label="Dismiss installation"
            onClick={hide}
          >
            <X className="size-4" />
          </Button>
        </div>
        {failure && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {failure}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {cli.canInstall && (
            <Button
              variant="outline"
              disabled={installing}
              onClick={() => {
                setInstallError(null);
                void provider({ kind: "install", id: cli.id }).catch((cause: unknown) => {
                  if (mounted.current)
                    setInstallError(
                      cause instanceof Error ? cause.message : `Could not install ${cli.label}`,
                    );
                });
              }}
            >
              {installing ? <LoaderCircle className="animate-spin" /> : <Download />}
              {installing ? "Installing…" : `Install ${cli.label}`}
            </Button>
          )}
          {cli.installLink && (
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                if (cli.installLink)
                  void openExternal(cli.installLink).catch(() =>
                    setInstallError("Could not open the installation guide."),
                  );
              }}
            >
              Installation guide
              <ExternalLink className="size-3" />
            </Button>
          )}
        </div>
      </section>
    );
  }
  // An unresolved initial check is not evidence that the user needs to sign in.
  // Keep failures visible so the account check can still be retried.
  if ((!account && !error) || account?.status === "connected") return null;
  const methods = account?.methods ?? [];
  const selected = methods.find((m) => m.id === method) ?? methods[0];
  const challenge = account?.challenge;
  return (
    <section
      aria-label={`${label} account connection`}
      className="rounded-xl border bg-muted/30 p-3 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            Connect your{" "}
            {(agent.engine ?? agent.provider) === "codex"
              ? "ChatGPT"
              : (agent.engine ?? agent.provider) === "claude"
                ? "Claude"
                : "model provider"}{" "}
            account
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Use your account on this machine. You can dismiss this and continue with your current
            setup.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          aria-label="Dismiss account connection"
          onClick={hide}
        >
          <X className="size-4" />
        </Button>
      </div>
      {(error || account?.message) && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error ?? account?.message}
        </p>
      )}
      {challenge ? (
        <div className="mt-3 space-y-2">
          {challenge.instructions && (
            <p className="text-xs text-muted-foreground">{challenge.instructions}</p>
          )}
          {challenge.code && (
            <div className="flex items-center gap-2">
              <code className="rounded border bg-background px-3 py-2 text-base tracking-wider">
                {challenge.code}
              </code>
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy sign-in code"
                onClick={() => {
                  if (challenge.code)
                    void copyText(challenge.code).then(
                      () => {
                        setCopied(true);
                        setError(null);
                      },
                      () => {
                        setCopied(false);
                        setError("Could not copy. Select the code and copy it manually.");
                      },
                    );
                }}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </Button>
            </div>
          )}
          {challenge.url && (
            <Button
              variant="outline"
              onClick={() => {
                if (challenge.url)
                  void openExternal(challenge.url).catch(() =>
                    setError("Could not open sign-in. Try again."),
                  );
              }}
            >
              Open sign-in page
              <ExternalLink className="size-3" />
            </Button>
          )}
          {challenge.input && (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (value.trim())
                  void request({ type: "complete", flowId: challenge.flowId, value: value.trim() });
              }}
            >
              <input
                className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                type="password"
                autoComplete="off"
                spellCheck={false}
                aria-label={
                  challenge.input === "api-key" ? "Provider API key" : "Authorization code"
                }
                placeholder={
                  challenge.input === "api-key" ? "Paste your API key" : "Paste authorization code"
                }
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={busy}
                maxLength={8192}
              />
              <Button variant="outline" type="submit" disabled={busy || !value.trim()}>
                Connect
              </Button>
            </form>
          )}
          <div className="flex items-center justify-between gap-2">
            <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LoaderCircle className="size-3 animate-spin" />
              Waiting for sign-in…
            </span>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setValue("");
                void request({ type: "cancel", flowId: challenge.flowId });
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {methods.length > 1 && (
            <select
              aria-label="Account sign-in method"
              className="max-w-full min-w-0 rounded-md border bg-background px-2 py-1.5 text-xs"
              value={selected?.id ?? ""}
              onChange={(e) => setMethod(e.target.value)}
              disabled={busy}
            >
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
          {selected && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setCopied(false);
                void request({ type: "start", methodId: selected.id });
              }}
            >
              {busy
                ? "Connecting…"
                : selected.kind === "api-key"
                  ? "Add API key"
                  : methods.length === 1
                    ? selected.label
                    : "Connect account"}
            </Button>
          )}
          {!selected && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void request({ type: "read" })}
            >
              {busy ? "Checking account…" : "Check account"}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
