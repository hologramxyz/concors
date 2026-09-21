import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  PROVIDER_SUBSCRIPTIONS_CAPABILITY,
  type AgentAccount,
  type AgentAccountAction,
  type ProviderOperation,
  type ProviderStatus,
} from "@concors/protocol";
import {
  describeDaemonEndpoint,
  type ConnectionState,
  type DaemonConnection,
  type DaemonEndpoint,
} from "@concors/daemon-client";
import type { Machine } from "@concors/api-client";
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
import { MachineIcon } from "@/machines/machine-icon";
import { useMachineList } from "@/machines/use-machines";
import { activeOrganization, type SignedInAuth } from "@/auth/auth-state";
import { useDaemonConnection } from "@/daemon/use-daemon-connection";
import { invalidateModelCatalogs } from "@/agents/model-catalog";
import { copyText } from "@/lib/clipboard";
import { openExternal } from "@/tauri/open-external";
import { Section, SettingsCard } from "@/views/settings-primitives";
import {
  subscriptionConfig,
  portableSubscriptionConfig,
  renamedAccountConfig,
  subscriptionEngineLabels,
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

export interface SubscriptionsSettingsProps {
  readonly auth?: SignedInAuth;
  readonly localEndpoint?: DaemonEndpoint | null;
  readonly hostScope?: string;
}

export function SubscriptionsSettings({
  auth,
  localEndpoint,
  hostScope = "",
}: SubscriptionsSettingsProps) {
  const selectedConnection = useContext(TerminalConnectionContext);
  const selectedState = useConnectionState(selectedConnection);
  const localHandle = useDaemonConnection(localEndpoint ?? null, "local", hostScope);
  const localConnection = localEndpoint ? localHandle.transport : selectedConnection;
  const localState = localEndpoint ? localHandle.state : selectedState;
  const local = useProviderMachine(localConnection, localState);
  const organization = auth ? activeOrganization(auth) : undefined;
  const machineList = useMachineList(organization?.id, !!auth);
  const [machineData, setMachineData] = useState<Record<string, ProviderSnapshot | null>>({});
  const [accountLabels, setAccountLabels] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [accountEpoch, setAccountEpoch] = useState(0);
  const subscriptions = (local.data?.providers ?? [])
    .filter((provider) => provider.subscription)
    .sort((a, b) => a.label.localeCompare(b.label));
  const availableMachines =
    machineList.data?.filter((machine) => machine.status !== "deleted") ?? [];
  const reportMachine = useCallback((machineId: string, data: ProviderSnapshot | null) => {
    setMachineData((current) =>
      current[machineId] === data ? current : { ...current, [machineId]: data },
    );
  }, []);
  const reportAccountLabel = useCallback((id: string, label: string | undefined) => {
    if (!label) return;
    setAccountLabels((current) => (current[id] === label ? current : { ...current, [id]: label }));
  }, []);
  const accountChanged = useCallback(() => setAccountEpoch((epoch) => epoch + 1), []);
  const usedOn = (id: string) =>
    [local.data, ...Object.values(machineData)].filter((snapshot) =>
      snapshot?.providers.some((provider) => provider.id === id && provider.active),
    ).length;
  const connectingProvider = connecting
    ? local.data?.providers.find((provider) => provider.id === connecting)
    : undefined;
  const visibleError = pageError ?? local.error;
  return (
    <Section
      title="Subscriptions"
      description="Add your accounts, then choose which one each machine uses."
    >
      {visibleError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {visibleError}
        </p>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">Machine assignments</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">One account per provider.</p>
          </div>
        </div>
        <div className="space-y-3">
          <MachineAssignmentCard
            machineId="local"
            name="This computer"
            local
            connection={localConnection}
            machine={local}
            subscriptions={subscriptions}
            accountLabels={accountLabels}
          />
          {availableMachines.map((machine) => (
            <RemoteMachineAssignment
              key={machine.id}
              machine={machine}
              hostScope={hostScope}
              subscriptions={subscriptions}
              accountLabels={accountLabels}
              onSnapshot={reportMachine}
            />
          ))}
          {machineList.data === null && !machineList.error && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading machines…
            </p>
          )}
        </div>
        {!!machineList.error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            Could not load machines.
          </p>
        )}
      </div>

      <div className="mt-8">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Your subscriptions</h3>
          <Button
            variant="outline"
            size="sm"
            disabled={!local.supported || !local.data}
            onClick={() => setAdding(true)}
          >
            <Plus /> Add subscription
          </Button>
        </div>
        <SettingsCard className="divide-y">
          {subscriptions.map((provider) => (
            <SubscriptionLibraryRow
              key={provider.id}
              connection={localConnection}
              provider={provider}
              epoch={accountEpoch}
              busy={local.busy}
              usedOn={usedOn(provider.id)}
              onAccountLabel={reportAccountLabel}
              onConnect={() => setConnecting(provider.id)}
              onRename={(current, accountNickname) =>
                local.execute({
                  kind: "save",
                  config: renamedAccountConfig(current, accountNickname),
                  expectedRevision: local.data?.revision ?? 0,
                })
              }
              onRemove={() => {
                const count = usedOn(provider.id);
                if (count) {
                  setPageError(
                    `Unassign ${accountName(provider, accountLabels)} before removing it.`,
                  );
                  return;
                }
                setPageError(null);
                void local
                  .execute({
                    kind: "remove",
                    id: provider.id,
                    expectedRevision: local.data?.revision ?? 0,
                  })
                  .catch(() => undefined);
              }}
            />
          ))}
          {local.data && subscriptions.length === 0 && (
            <p className="px-4 py-5 text-sm text-muted-foreground">No subscriptions added yet.</p>
          )}
          {!local.data && <p className="px-4 py-5 text-sm text-muted-foreground">Connecting…</p>}
        </SettingsCard>
      </div>

      {adding && local.data && (
        <AddSubscriptionDialog
          providers={local.data.providers}
          revision={local.data.revision}
          onSave={local.execute}
          onCreated={(id) => {
            setAdding(false);
            setConnecting(id);
          }}
          onClose={() => setAdding(false)}
        />
      )}
      {connectingProvider && localConnection && (
        <AccountConnectDialog
          connection={localConnection}
          provider={connectingProvider}
          onChanged={accountChanged}
          onClose={() => setConnecting(null)}
        />
      )}
    </Section>
  );
}

interface ProviderSnapshot {
  revision: number;
  providers: ProviderStatus[];
}

interface ProviderMachineState {
  data: ProviderSnapshot | null;
  error: string | null;
  busy: boolean;
  supported: boolean;
  state: ConnectionState | undefined;
  execute(operation: ProviderOperation): Promise<ProviderSnapshot>;
}

function useConnectionState(connection: DaemonConnection | null) {
  const [observed, setObserved] = useState<{
    connection: DaemonConnection;
    state: ConnectionState;
  } | null>(connection ? { connection, state: connection.state } : null);
  useEffect(
    () =>
      connection?.subscribe((state) => {
        setObserved({ connection, state });
      }),
    [connection],
  );
  return observed?.connection === connection ? observed.state : connection?.state;
}

function useProviderMachine(
  connection: DaemonConnection | null,
  state: ConnectionState | undefined,
): ProviderMachineState {
  const [snapshot, setSnapshot] = useState<{
    connection: DaemonConnection;
    data: ProviderSnapshot;
  } | null>(null);
  const [machineError, setMachineError] = useState<{
    connection: DaemonConnection | null;
    message: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const supported =
    state?.status === "ready" &&
    !!state.daemon.capabilities?.includes(PROVIDER_SUBSCRIPTIONS_CAPABILITY);
  const request = useCallback(
    async (operation: ProviderOperation) => {
      if (!connection) throw new Error("This machine is unavailable.");
      const result = await connection.requestProvider(operation, crypto.randomUUID());
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      if (operation.kind !== "list") invalidateModelCatalogs(connection);
      if (mounted.current) setSnapshot({ connection, data: result.outcome });
      return result.outcome;
    },
    [connection],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, [connection]);
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    const refresh = () => {
      void request({ kind: "list" }).then(
        () => !cancelled && setMachineError({ connection, message: null }),
        (cause: Error) => !cancelled && setMachineError({ connection, message: cause.message }),
      );
    };
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connection, request, supported]);
  const execute = useCallback(
    async (operation: ProviderOperation) => {
      setBusy(true);
      setMachineError({ connection, message: null });
      try {
        return await request(operation);
      } catch (cause) {
        setMachineError({
          connection,
          message: cause instanceof Error ? cause.message : "Could not update subscriptions",
        });
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [connection, request],
  );
  const data = snapshot?.connection === connection ? snapshot.data : null;
  const error = machineError?.connection === connection ? machineError.message : null;
  return { data, error, busy, supported, state, execute };
}

function RemoteMachineAssignment({
  machine,
  hostScope,
  subscriptions,
  accountLabels,
  onSnapshot,
}: {
  machine: Machine;
  hostScope: string;
  subscriptions: ProviderStatus[];
  accountLabels: Record<string, string>;
  onSnapshot: (machineId: string, data: ProviderSnapshot | null) => void;
}) {
  const endpoint = useMemo(
    () =>
      machine.status === "running" && machine.hostname
        ? describeDaemonEndpoint(`wss://${machine.hostname}/ws`, machine.name)
        : null,
    [machine.hostname, machine.name, machine.status],
  );
  const handle = useDaemonConnection(endpoint, machine.id, hostScope);
  const providerMachine = useProviderMachine(handle.transport, handle.state);
  useEffect(
    () => onSnapshot(machine.id, providerMachine.data),
    [machine.id, onSnapshot, providerMachine.data],
  );
  return (
    <MachineAssignmentCard
      machineId={machine.id}
      name={machine.name}
      {...(machine.icon === undefined ? {} : { icon: machine.icon })}
      connection={handle.transport}
      machine={providerMachine}
      subscriptions={subscriptions}
      accountLabels={accountLabels}
      unavailable={!endpoint}
    />
  );
}

function MachineAssignmentCard({
  machineId,
  name,
  icon,
  local = false,
  connection,
  machine,
  subscriptions,
  accountLabels,
  unavailable = false,
}: {
  machineId: string;
  name: string;
  icon?: string | null;
  local?: boolean;
  connection: DaemonConnection | null;
  machine: ProviderMachineState;
  subscriptions: ProviderStatus[];
  accountLabels: Record<string, string>;
  unavailable?: boolean;
}) {
  const [connecting, setConnecting] = useState<string | null>(null);
  const [accountEpoch, setAccountEpoch] = useState(0);
  const accountChanged = useCallback(() => setAccountEpoch((epoch) => epoch + 1), []);
  const connectingProvider = connecting
    ? machine.data?.providers.find((provider) => provider.id === connecting)
    : undefined;
  const status = unavailable
    ? "Provisioning"
    : machine.state?.status === "ready"
      ? machine.supported
        ? "Online"
        : "Update required"
      : machine.state?.status === "error"
        ? "Unavailable"
        : "Connecting…";
  return (
    <div role="group" aria-label={`${name} assignments`}>
      <SettingsCard>
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <MachineIcon local={local} icon={icon} className="size-4 text-muted-foreground" />
          <h4 className="min-w-0 flex-1 truncate text-sm font-medium">{name}</h4>
          <span className="text-xs text-muted-foreground">{status}</span>
        </div>
        <div className="divide-y">
          {(["claude", "codex"] as const).map((engine) => (
            <ProviderAssignment
              key={engine}
              machineId={machineId}
              machineName={name}
              engine={engine}
              connection={connection}
              machine={machine}
              subscriptions={subscriptions}
              accountLabels={accountLabels}
              epoch={accountEpoch}
              onConnect={setConnecting}
            />
          ))}
        </div>
        {machine.error && (
          <p role="alert" className="border-t px-4 py-2 text-xs text-destructive">
            {machine.error}
          </p>
        )}
        {connectingProvider && connection && (
          <AccountConnectDialog
            connection={connection}
            provider={connectingProvider}
            onChanged={accountChanged}
            onClose={() => setConnecting(null)}
          />
        )}
      </SettingsCard>
    </div>
  );
}

function ProviderAssignment({
  machineName,
  engine,
  connection,
  machine,
  subscriptions,
  accountLabels,
  epoch,
  onConnect,
}: {
  machineId: string;
  machineName: string;
  engine: SubscriptionEngine;
  connection: DaemonConnection | null;
  machine: ProviderMachineState;
  subscriptions: ProviderStatus[];
  accountLabels: Record<string, string>;
  epoch: number;
  onConnect: (id: string) => void;
}) {
  const choices = subscriptions.filter((provider) => provider.engine === engine);
  const active = machine.data?.providers.find(
    (provider) => provider.engine === engine && provider.subscription && provider.active,
  );
  const managed = active && choices.some((provider) => provider.id === active.id);
  const [accountResult, setAccountResult] = useState<{
    connection: DaemonConnection;
    providerId: string;
    account: AgentAccount | null;
    failed: boolean;
  } | null>(null);
  const account =
    accountResult?.connection === connection && accountResult.providerId === active?.id
      ? accountResult.account
      : null;
  const checkingFailed =
    accountResult?.connection === connection && accountResult.providerId === active?.id
      ? accountResult.failed
      : false;
  useEffect(() => {
    if (!connection || !active?.installed || !active.enabled) return;
    let cancelled = false;
    requestAccount(connection, active.id, { type: "read" }).then(
      (next) =>
        !cancelled &&
        setAccountResult({ connection, providerId: active.id, account: next, failed: false }),
      () =>
        !cancelled &&
        setAccountResult({ connection, providerId: active.id, account: null, failed: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [active?.enabled, active?.id, active?.installed, connection, epoch]);
  const assign = async (id: string) => {
    if (!machine.data) throw new Error("This machine is unavailable.");
    let revision = machine.data.revision;
    if (id && !machine.data.providers.some((provider) => provider.id === id)) {
      const source = choices.find((provider) => provider.id === id);
      if (!source) throw new Error("Choose an available subscription.");
      revision = (
        await machine.execute({
          kind: "save",
          config: portableSubscriptionConfig(source),
          expectedRevision: revision,
        })
      ).revision;
    }
    await machine.execute({ kind: "activate", engine, id: id || null, expectedRevision: revision });
  };
  const status = !active
    ? "Not assigned"
    : !managed
      ? "Subscription is no longer in your library"
      : checkingFailed
        ? "Could not check sign-in"
        : !account
          ? "Checking sign-in…"
          : account.status === "connected"
            ? "Signed in"
            : "Needs sign-in";
  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-center">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ProviderIcon provider={engine} />
        {subscriptionEngineLabels[engine]}
      </div>
      <div className="min-w-0">
        <select
          aria-label={`${machineName} ${subscriptionEngineLabels[engine]} subscription`}
          className="h-9 w-full min-w-0 rounded-md border bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          value={active?.id ?? ""}
          disabled={!machine.supported || !machine.data || machine.busy}
          onChange={(event) => void assign(event.target.value).catch(() => undefined)}
        >
          <option value="">Not assigned</option>
          {active && !managed && <option value={active.id}>Unavailable subscription</option>}
          {choices.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {accountName(provider, accountLabels)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">{status}</p>
      </div>
      <div className="sm:w-24 sm:text-right">
        {active && managed && account?.status !== "connected" && (
          <Button
            variant="outline"
            size="sm"
            disabled={!machine.supported || machine.busy}
            aria-label={`Connect ${subscriptionEngineLabels[engine]} on ${machineName}`}
            onClick={() => onConnect(active.id)}
          >
            Connect
          </Button>
        )}
      </div>
    </div>
  );
}

function accountName(provider: ProviderStatus, labels: Record<string, string>) {
  return (
    provider.accountNickname ??
    labels[provider.id] ??
    (provider.subscription?.nickname !== "Account" ? provider.subscription?.nickname : undefined) ??
    "Account"
  );
}

function SubscriptionLibraryRow({
  connection,
  provider,
  epoch,
  busy,
  usedOn,
  onAccountLabel,
  onConnect,
  onRename,
  onRemove,
}: {
  connection: DaemonConnection | null;
  provider: ProviderStatus;
  epoch: number;
  busy: boolean;
  usedOn: number;
  onAccountLabel: (id: string, label: string | undefined) => void;
  onConnect: () => void;
  onRename: (provider: ProviderStatus, name: string | undefined) => Promise<unknown>;
  onRemove: () => void;
}) {
  const [account, setAccount] = useState<AgentAccount | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  useEffect(() => {
    if (!connection || !provider.installed || !provider.enabled) return;
    let cancelled = false;
    requestAccount(connection, provider.id, { type: "read" }).then(
      (next) => {
        if (cancelled) return;
        setAccount(next);
        onAccountLabel(provider.id, next.label);
        setFailed(false);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [connection, provider.id, provider.installed, provider.enabled, epoch, onAccountLabel]);
  const connected = account?.status === "connected";
  const providerFallback = provider.subscription?.nickname;
  const name =
    provider.accountNickname ??
    account?.label ??
    (providerFallback && providerFallback !== "Account" ? providerFallback : "Account");
  const status = !provider.installed
    ? "Not installed · Install it in Providers settings"
    : !provider.enabled
      ? "Disabled in Providers settings"
      : failed
        ? "Could not check the sign-in"
        : !account
          ? "Checking sign-in…"
          : connected
            ? `Connected${account.label && account.label !== name ? ` · ${account.label}` : ""}`
            : "Not connected";
  return (
    <div
      role="group"
      aria-label={`${subscriptionEngineLabels[provider.engine as SubscriptionEngine]} subscription ${name}`}
      className="flex flex-wrap items-center gap-3 px-4 py-3"
    >
      <ProviderIcon provider={provider.engine} />
      <div className="min-w-0 flex-1 basis-32">
        <p className="font-medium">{name}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {status}
          {usedOn ? ` · Used on ${usedOn} machine${usedOn === 1 ? "" : "s"}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {provider.installed && provider.enabled && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onConnect}>
            {connected ? "Manage" : "Connect"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Rename ${name}`}
          disabled={busy}
          onClick={() => setRenaming(true)}
        >
          <Pencil />
        </Button>
        {confirming ? (
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
        )}
      </div>
      {renaming && (
        <RenameAccountDialog
          name={provider.accountNickname ?? ""}
          fallbackName={account?.label ?? providerFallback ?? "Account"}
          onSave={(nextName) => onRename(provider, nextName)}
          onClose={() => setRenaming(false)}
        />
      )}
    </div>
  );
}

function RenameAccountDialog({
  name,
  fallbackName,
  onSave,
  onClose,
}: {
  name: string;
  fallbackName: string;
  onSave: (name: string | undefined) => Promise<unknown>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(value.trim() || undefined);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rename account");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename account</DialogTitle>
          <DialogDescription>Leave blank to use {fallbackName}.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            autoFocus
            aria-label="Account name"
            value={value}
            maxLength={100}
            placeholder={fallbackName}
            onChange={(event) => setValue(event.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
  onSave: (op: ProviderOperation) => Promise<unknown>;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const [engine, setEngine] = useState<SubscriptionEngine>("claude");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const submit = async () => {
    setError(null);
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
          <DialogDescription>Add an account to your subscription library.</DialogDescription>
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
            Name <span className="text-muted-foreground">(optional)</span>
            <Input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Defaults to account email"
              maxLength={100}
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
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);
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
          changed.current();
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
    [connection, provider.id],
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
          <DialogDescription>Sign in on this machine.</DialogDescription>
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
