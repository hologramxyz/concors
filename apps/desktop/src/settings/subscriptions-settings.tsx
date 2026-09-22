import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  AGENT_USAGE_TTL_MS,
  PROVIDER_SUBSCRIPTIONS_CAPABILITY,
  PROVIDER_USAGE_CAPABILITY,
  type AgentAccount,
  type AgentAccountAction,
  type AgentPlanUsage,
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
import { percentLabel, resetLabel, usageTone } from "@/agents/usage-labels";
import { cn } from "cn";
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
/** Settings pages unmount during navigation; keep successful reads in memory and refresh them quietly. */
const providerSnapshots = new Map<string, ProviderSnapshot>();
const accountSnapshots = new Map<string, Record<string, AgentAccount>>();
const usageSnapshots = new Map<string, Record<string, SubscriptionUsageState>>();
const usageCapabilities = new Map<string, boolean>();

function machineCacheKey(hostScope: string, machineId: string, endpointUrl: string | undefined) {
  return `${hostScope || endpointUrl || "unscoped"}:${machineId}`;
}

function rememberAccount(cacheKey: string, id: string, account: AgentAccount) {
  const accounts = { ...(accountSnapshots.get(cacheKey) ?? {}), [id]: account };
  accountSnapshots.set(cacheKey, accounts);
  return accounts;
}

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
  const localCacheKey = machineCacheKey(
    hostScope,
    "local",
    localEndpoint?.url ?? localConnection?.endpoint.url,
  );
  const local = useProviderMachine(localConnection, localState, localCacheKey);
  const organization = auth ? activeOrganization(auth) : undefined;
  const machineList = useMachineList(organization?.id, !!auth);
  const [machineData, setMachineData] = useState<Record<string, ProviderSnapshot | null>>({});
  const [accountState, setAccountState] = useState(() => ({
    cacheKey: localCacheKey,
    accounts: accountSnapshots.get(localCacheKey) ?? {},
  }));
  const [pageError, setPageError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [accountEpoch, setAccountEpoch] = useState(0);
  const subscriptions = (local.data?.providers ?? []).filter((provider) => provider.subscription);
  const accounts = useMemo(
    () =>
      accountState.cacheKey === localCacheKey
        ? accountState.accounts
        : (accountSnapshots.get(localCacheKey) ?? {}),
    [accountState, localCacheKey],
  );
  const accountLabels = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(accounts).flatMap(([id, account]) =>
          account.label ? [[id, account.label]] : [],
        ),
      ),
    [accounts],
  );
  const connectedIds = subscriptions
    .filter((provider) => accounts[provider.id]?.status === "connected")
    .map((provider) => provider.id);
  const reportedUsageSupport =
    localState?.status === "ready"
      ? !!localState.daemon.capabilities?.includes(PROVIDER_USAGE_CAPABILITY)
      : undefined;
  const usageSupported = useCachedCapability(
    localCacheKey,
    reportedUsageSupport,
    usageCapabilities,
  );
  const usages = useSubscriptionUsages(
    localConnection,
    connectedIds,
    usageSupported,
    local.workspaceReady,
    localCacheKey,
  );
  const availableMachines =
    machineList.data?.filter((machine) => machine.status !== "deleted") ?? [];
  const reportMachine = useCallback((machineId: string, data: ProviderSnapshot | null) => {
    setMachineData((current) =>
      current[machineId] === data ? current : { ...current, [machineId]: data },
    );
  }, []);
  const reportAccount = useCallback(
    (id: string, account: AgentAccount) => {
      setAccountState({
        cacheKey: localCacheKey,
        accounts: rememberAccount(localCacheKey, id, account),
      });
    },
    [localCacheKey],
  );
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
            cacheKey={localCacheKey}
            subscriptions={subscriptions}
            accountLabels={accountLabels}
            usages={usages}
          />
          {availableMachines.map((machine) => (
            <RemoteMachineAssignment
              key={machine.id}
              machine={machine}
              hostScope={hostScope}
              subscriptions={subscriptions}
              accountLabels={accountLabels}
              usages={usages}
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
              account={accounts[provider.id]}
              epoch={accountEpoch}
              busy={local.busy}
              workspaceReady={local.workspaceReady}
              usedOn={usedOn(provider.id)}
              usage={usages[provider.id]}
              usageSupported={usageSupported}
              onAccount={reportAccount}
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
  workspaceReady: boolean;
  state: ConnectionState | undefined;
  execute(operation: ProviderOperation): Promise<ProviderSnapshot>;
}

interface SubscriptionUsageState {
  usage: AgentPlanUsage | null;
  loading: boolean;
  error: string | null;
}

/** Limits refresh while this page is open; the last read prevents a reflow when the user returns. */
function useSubscriptionUsages(
  connection: DaemonConnection | null,
  providerIds: string[],
  supported: boolean,
  workspaceReady: boolean,
  cacheKey: string,
) {
  const [snapshot, setSnapshot] = useState<{
    cacheKey: string;
    usages: Record<string, SubscriptionUsageState>;
  }>(() => ({ cacheKey, usages: usageSnapshots.get(cacheKey) ?? {} }));
  const ids = providerIds.join("\n");
  useEffect(() => {
    if (!connection || !supported || !workspaceReady || !ids) return;
    let cancelled = false;
    const update = (id: string, state: SubscriptionUsageState) => {
      if (cancelled) return;
      setSnapshot((current) => {
        const usages = {
          ...(current.cacheKey === cacheKey
            ? current.usages
            : (usageSnapshots.get(cacheKey) ?? {})),
          [id]: state,
        };
        usageSnapshots.set(cacheKey, usages);
        return { cacheKey, usages };
      });
    };
    const markLoading = (id: string) => {
      if (cancelled) return;
      setSnapshot((current) => {
        const usages =
          current.cacheKey === cacheKey ? current.usages : (usageSnapshots.get(cacheKey) ?? {});
        return {
          cacheKey,
          usages: {
            ...usages,
            [id]: {
              usage: usages[id]?.usage ?? null,
              loading: true,
              error: null,
            },
          },
        };
      });
    };
    const failed = (id: string, message: string) => {
      const previous = usageSnapshots.get(cacheKey)?.[id];
      update(id, {
        usage: previous?.usage ?? null,
        loading: false,
        error: message,
      });
    };
    const refresh = () => {
      for (const id of ids.split("\n")) {
        markLoading(id);
        void connection.requestProvider({ kind: "usage", id }, crypto.randomUUID()).then(
          ({ outcome }) => {
            if (outcome.status === "error") failed(id, outcome.message);
            else
              update(id, {
                usage: outcome.usage ?? null,
                loading: false,
                error: outcome.usage ? null : "This machine did not report plan usage.",
              });
          },
          (cause: unknown) =>
            failed(id, cause instanceof Error ? cause.message : "Could not read plan usage."),
        );
      }
    };
    refresh();
    const timer = setInterval(refresh, AGENT_USAGE_TTL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [cacheKey, connection, ids, supported, workspaceReady]);
  if (!supported) return {};
  const usages =
    snapshot.cacheKey === cacheKey ? snapshot.usages : (usageSnapshots.get(cacheKey) ?? {});
  return Object.fromEntries(providerIds.flatMap((id) => (usages[id] ? [[id, usages[id]]] : [])));
}

function useCachedCapability(
  cacheKey: string,
  reported: boolean | undefined,
  cache: Map<string, boolean>,
) {
  useEffect(() => {
    if (reported === undefined) return;
    cache.set(cacheKey, reported);
  }, [cache, cacheKey, reported]);
  return reported ?? cache.get(cacheKey) ?? false;
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

function useWorkspaceReady(connection: DaemonConnection | null) {
  const [, rerender] = useState(0);
  useEffect(
    () => connection?.subscribeWorkspace(() => rerender((revision) => revision + 1)),
    [connection],
  );
  return connection?.workspace !== null && connection?.workspace !== undefined;
}

function useProviderMachine(
  connection: DaemonConnection | null,
  state: ConnectionState | undefined,
  cacheKey: string,
): ProviderMachineState {
  const [snapshot, setSnapshot] = useState<{
    cacheKey: string;
    data: ProviderSnapshot;
  } | null>(() => {
    const data = providerSnapshots.get(cacheKey);
    return data ? { cacheKey, data } : null;
  });
  const [machineError, setMachineError] = useState<{
    cacheKey: string;
    message: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const workspaceReady = useWorkspaceReady(connection);
  const supported =
    state?.status === "ready" &&
    !!state.daemon.capabilities?.includes(PROVIDER_SUBSCRIPTIONS_CAPABILITY);
  const request = useCallback(
    async (operation: ProviderOperation) => {
      if (!connection) throw new Error("This machine is unavailable.");
      const result = await connection.requestProvider(operation, crypto.randomUUID());
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      if (operation.kind !== "list") invalidateModelCatalogs(connection);
      providerSnapshots.set(cacheKey, result.outcome);
      if (mounted.current) setSnapshot({ cacheKey, data: result.outcome });
      return result.outcome;
    },
    [cacheKey, connection],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, [connection]);
  useEffect(() => {
    if (!supported || !workspaceReady) return;
    let cancelled = false;
    const refresh = () => {
      void request({ kind: "list" }).then(
        () => !cancelled && setMachineError({ cacheKey, message: null }),
        (cause: Error) => {
          if (!cancelled && !providerSnapshots.has(cacheKey))
            setMachineError({ cacheKey, message: cause.message });
        },
      );
    };
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [cacheKey, request, supported, workspaceReady]);
  const execute = useCallback(
    async (operation: ProviderOperation) => {
      setBusy(true);
      setMachineError({ cacheKey, message: null });
      try {
        return await request(operation);
      } catch (cause) {
        setMachineError({
          cacheKey,
          message: cause instanceof Error ? cause.message : "Could not update subscriptions",
        });
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [cacheKey, request],
  );
  const data =
    snapshot?.cacheKey === cacheKey ? snapshot.data : (providerSnapshots.get(cacheKey) ?? null);
  const error = machineError?.cacheKey === cacheKey ? machineError.message : null;
  return { data, error, busy, supported, workspaceReady, state, execute };
}

function RemoteMachineAssignment({
  machine,
  hostScope,
  subscriptions,
  accountLabels,
  usages,
  onSnapshot,
}: {
  machine: Machine;
  hostScope: string;
  subscriptions: ProviderStatus[];
  accountLabels: Record<string, string>;
  usages: Record<string, SubscriptionUsageState>;
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
  const cacheKey = machineCacheKey(hostScope, machine.id, endpoint?.url);
  const providerMachine = useProviderMachine(handle.transport, handle.state, cacheKey);
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
      cacheKey={cacheKey}
      subscriptions={subscriptions}
      accountLabels={accountLabels}
      usages={usages}
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
  cacheKey,
  subscriptions,
  accountLabels,
  usages,
  unavailable = false,
}: {
  machineId: string;
  name: string;
  icon?: string | null;
  local?: boolean;
  connection: DaemonConnection | null;
  machine: ProviderMachineState;
  cacheKey: string;
  subscriptions: ProviderStatus[];
  accountLabels: Record<string, string>;
  usages: Record<string, SubscriptionUsageState>;
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
              cacheKey={cacheKey}
              subscriptions={subscriptions}
              accountLabels={accountLabels}
              usages={usages}
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
  cacheKey,
  subscriptions,
  accountLabels,
  usages,
  epoch,
  onConnect,
}: {
  machineId: string;
  machineName: string;
  engine: SubscriptionEngine;
  connection: DaemonConnection | null;
  machine: ProviderMachineState;
  cacheKey: string;
  subscriptions: ProviderStatus[];
  accountLabels: Record<string, string>;
  usages: Record<string, SubscriptionUsageState>;
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
  const cachedAccount = active ? (accountSnapshots.get(cacheKey)?.[active.id] ?? null) : null;
  const account =
    accountResult?.connection === connection && accountResult.providerId === active?.id
      ? (accountResult.account ?? cachedAccount)
      : cachedAccount;
  const checkingFailed =
    accountResult?.connection === connection && accountResult.providerId === active?.id
      ? accountResult.failed && !account
      : false;
  useEffect(() => {
    if (!connection || !machine.workspaceReady || !active?.installed || !active.enabled) return;
    let cancelled = false;
    requestAccount(connection, active.id, { type: "read" }).then(
      (next) => {
        if (cancelled) return;
        rememberAccount(cacheKey, active.id, next);
        setAccountResult({ connection, providerId: active.id, account: next, failed: false });
      },
      () =>
        !cancelled &&
        setAccountResult({ connection, providerId: active.id, account: null, failed: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [
    active?.enabled,
    active?.id,
    active?.installed,
    cacheKey,
    connection,
    epoch,
    machine.workspaceReady,
  ]);
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
              {usageOptionLabel(usages[provider.id]?.usage)}
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

function usageOptionLabel(usage: AgentPlanUsage | null | undefined) {
  if (usage?.status !== "available") return "";
  const windows = usage.windows
    .filter((window) => window.usedPercent !== null)
    .sort((a, b) => (b.usedPercent ?? 0) - (a.usedPercent ?? 0))
    .slice(0, 2);
  if (windows.length)
    return ` · ${windows.map((window) => `${window.label} ${percentLabel(window.usedPercent)}`).join(" · ")}`;
  return usage.planLabel ? ` · ${usage.planLabel}` : "";
}

function SubscriptionLibraryRow({
  connection,
  provider,
  account,
  epoch,
  busy,
  workspaceReady,
  usedOn,
  usage,
  usageSupported,
  onAccount,
  onConnect,
  onRename,
  onRemove,
}: {
  connection: DaemonConnection | null;
  provider: ProviderStatus;
  account: AgentAccount | undefined;
  epoch: number;
  busy: boolean;
  workspaceReady: boolean;
  usedOn: number;
  usage: SubscriptionUsageState | undefined;
  usageSupported: boolean;
  onAccount: (id: string, account: AgentAccount) => void;
  onConnect: () => void;
  onRename: (provider: ProviderStatus, name: string | undefined) => Promise<unknown>;
  onRemove: () => void;
}) {
  const [failure, setFailure] = useState<{
    connection: DaemonConnection;
    providerId: string;
    epoch: number;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const accountRef = useRef(account);
  useEffect(() => {
    accountRef.current = account;
  }, [account]);
  useEffect(() => {
    if (!connection || !workspaceReady || !provider.installed || !provider.enabled) return;
    let cancelled = false;
    requestAccount(connection, provider.id, { type: "read" }).then(
      (next) => {
        if (cancelled) return;
        onAccount(provider.id, next);
        setFailure(null);
      },
      () => {
        if (!cancelled && !accountRef.current)
          setFailure({ connection, providerId: provider.id, epoch });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    connection,
    provider.id,
    provider.installed,
    provider.enabled,
    epoch,
    onAccount,
    workspaceReady,
  ]);
  const failed =
    failure?.connection === connection &&
    failure.providerId === provider.id &&
    failure.epoch === epoch;
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
  const checkingAccount = provider.installed && provider.enabled && !account && !failed;
  return (
    <div
      role="group"
      aria-label={`${subscriptionEngineLabels[provider.engine as SubscriptionEngine]} subscription ${name}`}
      className="flex flex-wrap items-start gap-3 px-4 py-3"
    >
      <ProviderIcon provider={provider.engine} />
      <div className="min-w-0 flex-1 basis-32">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="font-medium">{name}</p>
          {usage?.usage?.planLabel && (
            <span className="text-xs text-muted-foreground">{usage.usage.planLabel}</span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {status}
          {usedOn ? ` · Used on ${usedOn} machine${usedOn === 1 ? "" : "s"}` : ""}
        </p>
        {usageSupported && (connected || checkingAccount) && (
          <SubscriptionUsage usage={connected ? usage : undefined} />
        )}
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

const usageBarColors = {
  ok: "bg-foreground/65",
  warning: "bg-amber-500",
  danger: "bg-destructive",
} as const;

function SubscriptionUsage({ usage: state }: { usage: SubscriptionUsageState | undefined }) {
  if (!state || (!state.usage && state.loading))
    return (
      <div
        role="status"
        aria-label="Reading usage"
        className="mt-2.5 flex min-h-11 flex-wrap gap-x-4 gap-y-2.5"
      >
        <span className="sr-only">Reading usage…</span>
        {["primary", "secondary"].map((slot) => (
          <div key={slot} className="w-44 max-w-full motion-safe:animate-pulse">
            <div className="h-3 w-24 rounded bg-muted/70" />
            <div className="mt-1.5 h-1 rounded-full bg-muted" />
            <div className="mt-1.5 h-2 w-16 rounded bg-muted/60" />
          </div>
        ))}
      </div>
    );
  if (state.error && !state.usage)
    return (
      <p className="mt-2.5 min-h-11 text-xs text-muted-foreground" title={state.error}>
        Usage unavailable
      </p>
    );
  const usage = state.usage;
  if (!usage) return null;
  if (usage.status !== "available" || !usage.windows.length)
    return usage.message ? (
      <p className="mt-2.5 min-h-11 text-xs text-muted-foreground">{usage.message}</p>
    ) : null;
  return (
    <ul aria-label="Plan usage" className="mt-2.5 flex min-h-11 flex-wrap gap-x-4 gap-y-2.5">
      {usage.windows.map((window) => {
        const tone = usageTone(window.usedPercent);
        const reset = resetLabel(window.resetsAt);
        return (
          <li key={window.id} className="w-44 max-w-full">
            <p className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="min-w-0 truncate font-medium">{window.label}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {percentLabel(window.usedPercent)}
              </span>
            </p>
            <div
              role="progressbar"
              aria-label={window.label}
              aria-valuenow={window.usedPercent ?? undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                data-usage-tone={tone ?? "unknown"}
                className={cn(
                  "h-full rounded-full",
                  tone ? usageBarColors[tone] : "bg-transparent",
                )}
                style={{ width: `${Math.min(100, Math.max(0, window.usedPercent ?? 0))}%` }}
              />
            </div>
            {reset && (
              <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">{reset}</p>
            )}
          </li>
        );
      })}
    </ul>
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
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Provider</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["claude", "codex"] as const).map((provider) => {
                const selected = engine === provider;
                return (
                  <label
                    key={provider}
                    className={cn(
                      "relative flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 transition-colors focus-within:ring-1 focus-within:ring-ring",
                      selected ? "border-foreground/40 bg-muted/60" : "hover:bg-muted/35",
                    )}
                  >
                    <input
                      type="radio"
                      name="provider"
                      value={provider}
                      checked={selected}
                      className="absolute inset-0 z-10 cursor-pointer opacity-0"
                      onChange={() => setEngine(provider)}
                    />
                    <span className="pointer-events-none flex size-9 shrink-0 items-center justify-center rounded-full border bg-background">
                      <ProviderIcon provider={provider} />
                    </span>
                    <span className="pointer-events-none min-w-0">
                      <span className="block text-sm font-medium">
                        {subscriptionEngineLabels[provider]}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {provider === "codex" ? "Codex" : "Claude Code"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
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
