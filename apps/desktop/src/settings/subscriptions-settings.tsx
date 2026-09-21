import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import {
  PROVIDER_SUBSCRIPTIONS_CAPABILITY,
  type AgentAccount,
  type AgentAccountAction,
  type ProviderOperation,
  type ProviderStatus,
} from "@concors/protocol";
import type { DaemonConnection } from "@concors/daemon-client";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ProviderIcon } from "@/agents/provider-icon";
import { invalidateModelCatalogs } from "@/agents/model-catalog";
import { copyText } from "@/lib/clipboard";
import { openExternal } from "@/tauri/open-external";
import { Section, SettingsCard } from "@/views/settings-primitives";
import {
  subscriptionConfig,
  subscriptionEngineLabels,
  subscriptionGroups,
  type SubscriptionEngine,
} from "./subscriptions";

/**
 * One account exchange at a time per subscription: the daemon rejects concurrent flows for the
 * same owner, so a status check and a sign-in dialog must take turns, not race.
 */
const accountQueues = new Map<string, Promise<unknown>>();
function requestAccount(connection: DaemonConnection, id: string, action: AgentAccountAction) {
  const key = `${connection.endpoint.url}:${id}`;
  const task = async () => {
    const result = await connection.requestProvider(
      { kind: "account", id, action },
      crypto.randomUUID(),
    );
    if (result.outcome.status === "error") throw new Error(result.outcome.message);
    const account = result.outcome.account;
    if (!account) throw new Error("This machine needs a daemon update to connect accounts here.");
    return account;
  };
  const next = (accountQueues.get(key) ?? Promise.resolve()).then(task, task);
  accountQueues.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export function SubscriptionsSettings() {
  const connection = useContext(TerminalConnectionContext);
  const [state, setState] = useState(connection?.state);
  const [data, setData] = useState<{ revision: number; providers: ProviderStatus[] } | null>(null);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [accountEpoch, setAccountEpoch] = useState(0);
  const mounted = useRef(true);
  const supported =
    state?.status === "ready" &&
    state.daemon.capabilities?.includes(PROVIDER_SUBSCRIPTIONS_CAPABILITY);
  const request = useCallback(
    async (operation: ProviderOperation, active: () => boolean = () => true) => {
      if (!connection) throw new Error("Reconnect to the machine first.");
      const result = await connection.requestProvider(operation, crypto.randomUUID());
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      if (operation.kind !== "list") invalidateModelCatalogs(connection);
      if (mounted.current && active()) {
        setData(result.outcome);
        if (operation.kind === "list") setRefreshError(null);
      }
    },
    [connection],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, [connection]);
  useEffect(() => connection?.subscribe(setState), [connection]);
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    const refresh = () => {
      void request({ kind: "list" }, () => !cancelled).catch((e: Error) => {
        if (!cancelled) setRefreshError(e.message);
      });
    };
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connection, supported, request]); // Poll also observes subscriptions added from another client.
  const execute = async (operation: ProviderOperation) => {
    setBusy(true);
    setError(null);
    try {
      await request(operation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update subscriptions");
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const groups = subscriptionGroups(data?.providers ?? []);
  const connectingProvider = connecting
    ? data?.providers.find((p) => p.id === connecting)
    : undefined;
  const visibleError = error ?? refreshError;
  return (
    <Section
      title="Subscriptions"
      description="Connect several Claude or ChatGPT accounts to this machine and choose which one it uses. Sign-ins stay side by side, so switching the whole machine over is instant."
      actions={
        <Button
          variant="outline"
          size="sm"
          disabled={!supported || !data}
          onClick={() => setAdding(true)}
        >
          <Plus /> Add subscription
        </Button>
      }
    >
      {!supported && (
        <p role="status" className="text-sm text-muted-foreground">
          Connect to a machine with subscription support. Update its daemon if this page is
          unavailable.
        </p>
      )}
      {visibleError && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {visibleError}
        </p>
      )}
      {supported && connection && (
        <>
          {groups.map((group) => (
            <div key={group.engine} className="mt-5">
              <div className="flex items-center gap-2">
                <ProviderIcon provider={group.engine} />
                <h3 className="text-sm font-medium">{group.label}</h3>
              </div>
              <SettingsCard className="mt-2 divide-y">
                {group.base && (
                  <SubscriptionRow
                    connection={connection}
                    provider={group.base}
                    name="Default account"
                    epoch={accountEpoch}
                    busy={busy}
                    onConnect={() => setConnecting(group.base?.id ?? null)}
                    onActivate={() =>
                      void execute({
                        kind: "activate",
                        engine: group.engine,
                        id: null,
                        expectedRevision: data?.revision ?? 0,
                      }).catch(() => {
                        /* The operation already displayed its error. */
                      })
                    }
                  />
                )}
                {group.subscriptions.map((provider) => (
                  <SubscriptionRow
                    key={provider.id}
                    connection={connection}
                    provider={provider}
                    name={provider.subscription?.nickname ?? provider.label}
                    epoch={accountEpoch}
                    busy={busy}
                    onConnect={() => setConnecting(provider.id)}
                    onActivate={() =>
                      void execute({
                        kind: "activate",
                        engine: group.engine,
                        id: provider.id,
                        expectedRevision: data?.revision ?? 0,
                      }).catch(() => {
                        /* The operation already displayed its error. */
                      })
                    }
                    onRemove={() =>
                      void execute({
                        kind: "remove",
                        id: provider.id,
                        expectedRevision: data?.revision ?? 0,
                      }).catch(() => {
                        /* The operation already displayed its error. */
                      })
                    }
                  />
                ))}
                {!group.base && group.subscriptions.length === 0 && (
                  <p role="status" className="p-4 text-sm text-muted-foreground">
                    {data ? `${group.label} is not set up on this machine.` : "Checking…"}
                  </p>
                )}
              </SettingsCard>
            </div>
          ))}
          <p className="mt-4 text-sm text-muted-foreground">
            The active subscription is used by every chat on this machine; other machines choose
            their own. Each subscription keeps its own sign-in on the connected machine and
            credentials never leave it. Removing a subscription signs it out there.
          </p>
        </>
      )}
      {adding && data && (
        <AddSubscriptionDialog
          providers={data.providers}
          revision={data.revision}
          onSave={execute}
          onCreated={(id) => {
            setAdding(false);
            setConnecting(id);
          }}
          onClose={() => setAdding(false)}
        />
      )}
      {connectingProvider && connection && (
        <AccountConnectDialog
          connection={connection}
          provider={connectingProvider}
          onChanged={() => setAccountEpoch((epoch) => epoch + 1)}
          onClose={() => setConnecting(null)}
        />
      )}
    </Section>
  );
}

function SubscriptionRow({
  connection,
  provider,
  name,
  epoch,
  busy,
  onConnect,
  onActivate,
  onRemove,
}: {
  connection: DaemonConnection;
  provider: ProviderStatus;
  name: string;
  epoch: number;
  busy: boolean;
  onConnect: () => void;
  onActivate?: () => void;
  onRemove?: () => void;
}) {
  const [account, setAccount] = useState<AgentAccount | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!provider.installed || !provider.enabled) return;
    let cancelled = false;
    requestAccount(connection, provider.id, { type: "read" }).then(
      (next) => {
        if (cancelled) return;
        setAccount(next);
        setFailed(false);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [connection, provider.id, provider.installed, provider.enabled, epoch]);
  const connected = account?.status === "connected";
  const status = !provider.installed
    ? "Not installed · Install it in Providers settings"
    : !provider.enabled
      ? "Disabled in Providers settings"
      : failed
        ? "Could not check the sign-in"
        : !account
          ? "Checking sign-in…"
          : connected
            ? `Connected${account.label ? ` · ${account.label}` : ""}`
            : "Not connected";
  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1 basis-32">
        <p className="flex items-center gap-2 font-medium">
          {name}
          {provider.active && (
            <span className="rounded-full border px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
              Active on this machine
            </span>
          )}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{status}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onActivate && !provider.active && provider.installed && provider.enabled && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label={`Use ${name} on this machine`}
            onClick={onActivate}
          >
            Use on this machine
          </Button>
        )}
        {provider.installed && provider.enabled && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onConnect}>
            {connected ? "Manage sign-in" : "Connect"}
          </Button>
        )}
        {onRemove &&
          (confirming ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  onRemove();
                }}
              >
                <Trash2 /> Sign out and remove
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Keep ${name}`}
                onClick={() => setConfirming(false)}
              >
                <X />
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${name}`}
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              <Trash2 />
            </Button>
          ))}
      </div>
    </div>
  );
}

function AddSubscriptionDialog({
  providers,
  revision,
  onSave,
  onCreated,
  onClose,
}: {
  providers: ProviderStatus[];
  revision: number;
  onSave: (op: ProviderOperation) => Promise<void>;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const [engine, setEngine] = useState<SubscriptionEngine>("claude");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const submit = async () => {
    setError(null);
    if (!nickname.trim()) {
      setError("Name the subscription, like Work or Personal.");
      return;
    }
    setBusy(true);
    try {
      const base = providers.find((p) => p.id === engine && !p.subscription);
      const config = subscriptionConfig(engine, nickname, base);
      await onSave({ kind: "save", config, expectedRevision: revision });
      onCreated(config.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the subscription");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a subscription</DialogTitle>
          <DialogDescription>
            Adds another {subscriptionEngineLabels[engine]} account next to the ones already on this
            machine. You sign in right after.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block space-y-1 text-sm">
            Provider
            <select
              className="h-9 w-full rounded border bg-background px-3"
              value={engine}
              onChange={(e) => setEngine(e.target.value as SubscriptionEngine)}
            >
              <option value="claude">Claude</option>
              <option value="codex">ChatGPT (Codex)</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            Name
            <Input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Work, Personal, …"
              maxLength={100}
              required
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy}>{busy ? "Adding…" : "Add subscription"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AccountConnectDialog({
  connection,
  provider,
  onChanged,
  onClose,
}: {
  connection: DaemonConnection;
  provider: ProviderStatus;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [account, setAccount] = useState<AgentAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState("");
  const [value, setValue] = useState("");
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);
  const latest = useRef<AgentAccount | null>(null);
  const reading = useRef(false);
  const request = useCallback(
    async (action: AgentAccountAction, background = false) => {
      if (action.type === "read") {
        if (reading.current) return;
        reading.current = true;
      }
      if (!background) setBusy(true);
      setError(null);
      try {
        const next = await requestAccount(connection, provider.id, action);
        if (!mounted.current) {
          if (next.challenge)
            void requestAccount(connection, provider.id, {
              type: "cancel",
              flowId: next.challenge.flowId,
            }).catch(() => undefined);
          return;
        }
        if (
          action.type === "read" &&
          latest.current?.status === "pending" &&
          next.status === "disconnected" &&
          !next.message
        )
          next.message = "Sign-in expired or was cancelled. Try again.";
        if (next.status === "connected" && latest.current?.status !== "connected") {
          invalidateModelCatalogs(connection);
          onChanged();
        }
        latest.current = next;
        setAccount(next);
        if (action.type === "complete" || next.status === "connected") setValue("");
      } catch (cause) {
        if (mounted.current)
          setError(cause instanceof Error ? cause.message : "Could not connect the account");
      } finally {
        if (action.type === "read") reading.current = false;
        if (mounted.current && !background) setBusy(false);
      }
    },
    [connection, provider.id, onChanged],
  );
  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(() => {
      if (mounted.current) void request({ type: "read" });
    });
    return () => {
      mounted.current = false;
      // Closing the dialog abandons an unfinished sign-in; it never signs an account out.
      const challenge = latest.current?.challenge;
      if (challenge)
        void requestAccount(connection, provider.id, {
          type: "cancel",
          flowId: challenge.flowId,
        }).catch(() => undefined);
    };
  }, [connection, provider.id, request]);
  useEffect(() => {
    if (account?.status !== "pending") return;
    const timer = setInterval(() => void request({ type: "read" }, true), 2000);
    return () => clearInterval(timer);
  }, [account?.status, request]);
  const methods = account?.methods ?? [];
  const selected = methods.find((m) => m.id === method) ?? methods[0];
  const challenge = account?.challenge;
  const name = provider.subscription?.nickname
    ? `${provider.label}`
    : `${provider.label} default account`;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            Signs this subscription in on the connected machine. The sign-in stays there, next to
            your other subscriptions.
          </DialogDescription>
        </DialogHeader>
        {(error || account?.message) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? account?.message}
          </p>
        )}
        {!account && !error && (
          <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" /> Checking sign-in…
          </p>
        )}
        {account?.status === "connected" && (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-1.5">
              <Check className="size-4 text-green-600" />
              Connected{account.label ? ` as ${account.label}` : ""}.
            </p>
            <p className="text-xs text-muted-foreground">
              To use a different account here, connect again and sign in with the other account.
            </p>
            <div className="flex justify-end gap-2">
              {selected && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setCopied(false);
                    void request({ type: "start", methodId: selected.id });
                  }}
                >
                  Sign in again
                </Button>
              )}
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
        {challenge && (
          <div className="space-y-2">
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
                    void request({
                      type: "complete",
                      flowId: challenge.flowId,
                      value: value.trim(),
                    });
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
                    challenge.input === "api-key"
                      ? "Paste your API key"
                      : "Paste authorization code"
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
              <span
                role="status"
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
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
        )}
        {account && account.status !== "connected" && !challenge && (
          <div className="flex flex-wrap items-center gap-2">
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
            {selected ? (
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
            ) : (
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
      </DialogContent>
    </Dialog>
  );
}
