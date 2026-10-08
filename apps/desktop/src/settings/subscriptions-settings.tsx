import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleOff,
  Copy,
  ExternalLink,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  AGENT_USAGE_TTL_MS,
  PROVIDER_SUBSCRIPTIONS_CAPABILITY,
  PROVIDER_USAGE_CAPABILITY,
  type AgentAccount,
  type AgentAccountAction,
  type AgentPlanUsage,
  type ProviderConfig,
  type ProviderOperation,
  type ProviderStatus,
} from "@concors/protocol";
import {
  describeDaemonEndpoint,
  type ConnectionState,
  type DaemonConnection,
  type DaemonEndpoint,
} from "@concors/daemon-client";
import { ApiError, type Machine, type ProviderSubscription } from "@concors/api-client";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { currentWindow, percentLabel, resetLabel, usageTone } from "@/agents/usage-labels";
import { cn } from "cn";
import { api } from "@/auth/api";
import { useProviderSubscriptions } from "@/data/provider-subscriptions";
import {
  accountName,
  libraryConfig,
  libraryFromProviders,
  libraryFromServer,
  isSubscriptionEngine,
  subscriptionConfig,
  renamedAccountConfig,
  subscriptionEngineLabels,
  type LibraryAccount,
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
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, AssignmentChange>>({});
  const [confirmingAssignments, setConfirmingAssignments] = useState(false);
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const assignmentTargets = useRef(new Map<string, AssignmentTarget>());
  // Signed in, the library is the person's, kept by the control plane, so every computer lists
  // the same accounts. Without an account (the mobile drawer) it is this computer's daemon's.
  const signedIn = !!auth;
  const server = useProviderSubscriptions(signedIn);
  const setServerLibrary = server.resource.set;
  const localSubscriptions = useMemo(
    () => (local.data?.providers ?? []).filter((provider) => provider.subscription),
    [local.data],
  );
  const localLibrary = useMemo(
    () => libraryFromProviders(localSubscriptions),
    [localSubscriptions],
  );
  const subscriptions = useMemo(
    () =>
      !signedIn
        ? localLibrary
        : server.data
          ? libraryFromServer(server.data)
          : server.error
            ? localLibrary
            : [],
    [localLibrary, server.data, server.error, signedIn],
  );
  const libraryReady = signedIn ? !!server.data || !!server.error : !!local.data;
  const libraryError =
    signedIn && server.error && !server.data
      ? "Could not load your subscriptions. Showing this computer's."
      : null;
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
  // An account not signed in on this computer can still show its limits, read from a machine that
  // is signed in to it: the one using it first.
  const [usageHosts, setUsageHosts] = useState<Record<string, DaemonConnection | null>>({});
  const reportUsageHost = useCallback((machineId: string, connection: DaemonConnection | null) => {
    setUsageHosts((current) =>
      current[machineId] === connection ? current : { ...current, [machineId]: connection },
    );
  }, []);
  const remoteSources = subscriptions
    .filter((account) => accounts[account.id]?.status !== "connected")
    .map((account) => ({
      id: account.id,
      hosts: availableMachines
        .flatMap((machine) => {
          const connection = usageHosts[machine.id];
          const held = machineData[machine.id]?.providers.find(
            (provider) => provider.id === account.id,
          );
          return connection && held
            ? [{ machineId: machine.id, name: machine.name, connection, active: !!held.active }]
            : [];
        })
        .sort((a, b) => Number(b.active) - Number(a.active)),
    }))
    .filter((source) => source.hosts.length > 0);
  const remoteUsages = useRemoteUsages(remoteSources);
  const allUsages = useMemo(() => ({ ...remoteUsages, ...usages }), [remoteUsages, usages]);
  // Accounts this computer or the person's own machines already hold join the library, so one
  // set up before the library was kept online is not lost. Others' machines are never read.
  const userId = auth?.user.id;
  const ownMachines = availableMachines
    .filter((machine) => machine.createdByUserId === userId)
    .map((machine) => machine.id)
    .join("\n");
  const importing = useRef(new Set<string>());
  useEffect(() => {
    if (!signedIn || !server.data) return;
    const known = new Set(server.data.map((row) => row.id));
    const own = new Set(ownMachines.split("\n"));
    const held = libraryFromProviders([
      ...localSubscriptions,
      ...Object.entries(machineData).flatMap(([id, data]) =>
        own.has(id) ? (data?.providers ?? []) : [],
      ),
    ]);
    const batch = held
      .filter(
        (account, index) =>
          !known.has(account.id) &&
          !importing.current.has(account.id) &&
          held.findIndex((other) => other.id === account.id) === index,
      )
      .slice(0, 64);
    if (!batch.length) return;
    for (const account of batch) importing.current.add(account.id);
    void api
      .importProviderSubscriptions(
        batch.map((account) => {
          const label = accountLabels[account.id];
          return {
            id: account.id,
            engine: account.engine,
            nickname: account.nickname,
            ...(account.accountNickname ? { accountNickname: account.accountNickname } : {}),
            ...(label ? { accountLabel: label.slice(0, 320) } : {}),
          };
        }),
      )
      .then(setServerLibrary, () => {
        // Another change to what the machines hold tries again.
        for (const account of batch) importing.current.delete(account.id);
      });
  }, [
    accountLabels,
    localSubscriptions,
    machineData,
    ownMachines,
    server.data,
    setServerLibrary,
    signedIn,
  ]);
  const reportMachine = useCallback((machineId: string, data: ProviderSnapshot | null) => {
    setMachineData((current) =>
      current[machineId] === data ? current : { ...current, [machineId]: data },
    );
  }, []);
  // The signed-in email is kept with the library, so other computers can show it before they
  // sign in themselves.
  const serverRows = useRef<ProviderSubscription[] | null>(server.data);
  useEffect(() => {
    serverRows.current = server.data;
  }, [server.data]);
  const savingLabels = useRef(new Set<string>());
  const rememberLabel = useCallback(
    (id: string, label: string) => {
      const row = serverRows.current?.find((candidate) => candidate.id === id);
      const accountLabel = label.slice(0, 320);
      if (!row || row.accountLabel === accountLabel || savingLabels.current.has(id)) return;
      savingLabels.current.add(id);
      void api
        .saveProviderSubscription(id, { engine: row.engine, nickname: row.nickname, accountLabel })
        .then(
          (saved) =>
            setServerLibrary((rows) =>
              (rows ?? []).map((candidate) => (candidate.id === saved.id ? saved : candidate)),
            ),
          () => undefined,
        )
        .finally(() => savingLabels.current.delete(id));
    },
    [setServerLibrary],
  );
  const reportAccount = useCallback(
    (id: string, account: AgentAccount) => {
      setAccountState({
        cacheKey: localCacheKey,
        accounts: rememberAccount(localCacheKey, id, account),
      });
      if (account.label) rememberLabel(id, account.label);
    },
    [localCacheKey, rememberLabel],
  );
  const accountChanged = useCallback(() => setAccountEpoch((epoch) => epoch + 1), []);
  const stageAssignment = useCallback(
    (
      machineId: string,
      machineName: string,
      engine: SubscriptionEngine,
      currentId: string,
      id: string,
    ) => {
      const key = `${machineId}:${engine}`;
      setAssignmentDrafts((current) => {
        if (id === currentId) {
          const { [key]: _, ...rest } = current;
          return rest;
        }
        return { ...current, [key]: { key, machineId, machineName, engine, id } };
      });
      setAssignmentError(null);
    },
    [],
  );
  const registerAssignmentTarget = useCallback(
    (machineId: string, target: AssignmentTarget | null) => {
      if (target) assignmentTargets.current.set(machineId, target);
      else assignmentTargets.current.delete(machineId);
    },
    [],
  );
  const saveAssignments = async () => {
    const changes = Object.values(assignmentDrafts);
    if (!changes.length) return;
    setSavingAssignments(true);
    setAssignmentError(null);
    const groups = new Map<string, AssignmentChange[]>();
    for (const change of changes)
      groups.set(change.machineId, [...(groups.get(change.machineId) ?? []), change]);
    const results = await Promise.all(
      [...groups.entries()].map(async ([machineId, machineChanges]) => {
        const target = assignmentTargets.current.get(machineId);
        if (!target)
          return {
            changes: machineChanges,
            error: `${machineChanges[0]?.machineName ?? "Machine"} is unavailable.`,
          };
        try {
          await target(machineChanges);
          return { changes: machineChanges, error: null };
        } catch (cause) {
          return {
            changes: machineChanges,
            error: cause instanceof Error ? cause.message : "Could not save subscription changes.",
          };
        }
      }),
    );
    const saved = new Set(
      results.flatMap((result) => (result.error ? [] : result.changes.map((change) => change.key))),
    );
    setAssignmentDrafts((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !saved.has(key))),
    );
    const failures = results.flatMap((result) => (result.error ? [result.error] : []));
    setSavingAssignments(false);
    if (failures.length) setAssignmentError(failures.join(" "));
    else setConfirmingAssignments(false);
  };
  const pendingAssignmentCount = Object.keys(assignmentDrafts).length;
  const assignedMachines = (id: string): AssignedMachine[] => [
    ...(local.data?.providers.some((provider) => provider.id === id && provider.active)
      ? [{ id: "local", name: "This computer", local: true }]
      : []),
    ...availableMachines.flatMap((machine) =>
      machineData[machine.id]?.providers.some((provider) => provider.id === id && provider.active)
        ? [
            {
              id: machine.id,
              name: machine.name,
              local: false,
              icon: machine.icon ?? null,
            },
          ]
        : [],
    ),
  ];
  const connectingProvider = connecting
    ? local.data?.providers.find((provider) => provider.id === connecting)
    : undefined;
  const localHolds = (id: string) => localSubscriptions.find((provider) => provider.id === id);
  /** Signing in on this computer first installs the account here, without its secrets. */
  const connectHere = async (account: LibraryAccount) => {
    setPageError(null);
    if (!localHolds(account.id))
      await local.execute({
        kind: "save",
        config: libraryConfig(account),
        expectedRevision: local.data?.revision ?? 0,
      });
    setConnecting(account.id);
  };
  const rename = async (account: LibraryAccount, accountNickname: string | undefined) => {
    if (signedIn) {
      const saved = await api.saveProviderSubscription(account.id, {
        engine: account.engine,
        nickname: account.nickname,
        accountNickname: accountNickname ?? null,
      });
      setServerLibrary((rows) => (rows ?? []).map((row) => (row.id === saved.id ? saved : row)));
    }
    const held = localHolds(account.id);
    if (held)
      await local.execute({
        kind: "save",
        config: renamedAccountConfig(held, accountNickname),
        expectedRevision: local.data?.revision ?? 0,
      });
  };
  const remove = async (account: LibraryAccount) => {
    if (signedIn) {
      await api.removeProviderSubscription(account.id).catch((cause: unknown) => {
        // Already removed elsewhere is what was asked for.
        if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
      });
      setServerLibrary((rows) => (rows ?? []).filter((row) => row.id !== account.id));
    }
    if (localHolds(account.id))
      await local.execute({
        kind: "remove",
        id: account.id,
        expectedRevision: local.data?.revision ?? 0,
      });
  };
  const visibleError = pageError ?? libraryError ?? local.error;
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
          <Button
            size="sm"
            disabled={!pendingAssignmentCount || savingAssignments}
            onClick={() => {
              setAssignmentError(null);
              setConfirmingAssignments(true);
            }}
          >
            Save changes
          </Button>
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
            usages={allUsages}
            drafts={assignmentDrafts}
            onDraft={stageAssignment}
            onRegister={registerAssignmentTarget}
            onLabel={rememberLabel}
          />
          {availableMachines.map((machine) => (
            <RemoteMachineAssignment
              key={machine.id}
              machine={machine}
              hostScope={hostScope}
              subscriptions={subscriptions}
              accountLabels={accountLabels}
              usages={allUsages}
              drafts={assignmentDrafts}
              onDraft={stageAssignment}
              onRegister={registerAssignmentTarget}
              onSnapshot={reportMachine}
              onUsageHost={reportUsageHost}
              onLabel={rememberLabel}
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
            disabled={!local.supported || !local.data || !libraryReady}
            onClick={() => setAdding(true)}
          >
            <Plus /> Add subscription
          </Button>
        </div>
        <SettingsCard className="divide-y">
          {subscriptions.map((entry) => (
            <SubscriptionLibraryRow
              key={entry.id}
              connection={localConnection}
              entry={entry}
              provider={localHolds(entry.id)}
              localSupported={local.supported && !!local.data}
              account={accounts[entry.id]}
              epoch={accountEpoch}
              busy={local.busy}
              workspaceReady={local.workspaceReady}
              usedOn={assignedMachines(entry.id)}
              usage={allUsages[entry.id]}
              usageSupported={usageSupported}
              onAccount={reportAccount}
              onConnect={() =>
                void connectHere(entry).catch((cause: unknown) =>
                  setPageError(
                    cause instanceof Error ? cause.message : "Could not set up the account here.",
                  ),
                )
              }
              onRename={rename}
              onRemove={() => {
                const count = assignedMachines(entry.id).length;
                if (count) {
                  setPageError(`Unassign ${accountName(entry, accountLabels)} before removing it.`);
                  return;
                }
                setPageError(null);
                void remove(entry).catch((cause: unknown) =>
                  setPageError(
                    cause instanceof Error ? cause.message : "Could not remove the account.",
                  ),
                );
              }}
            />
          ))}
          {libraryReady && subscriptions.length === 0 && (
            <p className="px-4 py-5 text-sm text-muted-foreground">No subscriptions added yet.</p>
          )}
          {!libraryReady && <p className="px-4 py-5 text-sm text-muted-foreground">Connecting…</p>}
        </SettingsCard>
      </div>

      {adding && local.data && (
        <AddSubscriptionDialog
          providers={local.data.providers}
          revision={local.data.revision}
          onSave={local.execute}
          onCreated={(config) => {
            setAdding(false);
            setConnecting(config.id);
            if (signedIn && config.subscription && isSubscriptionEngine(config.engine)) {
              // Saved directly; the import of what this computer holds need not race it.
              importing.current.add(config.id);
              void api
                .saveProviderSubscription(config.id, {
                  engine: config.engine,
                  nickname: config.subscription.nickname,
                  ...(config.accountNickname ? { accountNickname: config.accountNickname } : {}),
                })
                .then(
                  (saved) =>
                    setServerLibrary((rows) => [
                      ...(rows ?? []).filter((row) => row.id !== saved.id),
                      saved,
                    ]),
                  // Kept on this computer, it is imported on the next try.
                  () => importing.current.delete(config.id),
                );
            }
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
      <Dialog
        open={confirmingAssignments}
        onOpenChange={(open) => !savingAssignments && setConfirmingAssignments(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save subscription changes?</DialogTitle>
            <DialogDescription>
              Running tasks will finish with their current account. New tasks will use the selected
              accounts.
            </DialogDescription>
          </DialogHeader>
          {assignmentError && (
            <p role="alert" className="text-sm text-destructive">
              {assignmentError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={savingAssignments}
              onClick={() => setConfirmingAssignments(false)}
            >
              Cancel
            </Button>
            <Button disabled={savingAssignments} onClick={() => void saveAssignments()}>
              {savingAssignments ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

interface ProviderSnapshot {
  revision: number;
  providers: ProviderStatus[];
}

interface AssignedMachine {
  id: string;
  name: string;
  local: boolean;
  icon?: string | null;
}

interface AssignmentChange {
  key: string;
  machineId: string;
  machineName: string;
  engine: SubscriptionEngine;
  id: string;
}

type AssignmentTarget = (changes: AssignmentChange[]) => Promise<void>;

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
  /** The machine it was read from, when not this computer. */
  from?: string;
}

interface RemoteUsageSource {
  id: string;
  hosts: { machineId: string; name: string; connection: DaemonConnection }[];
}
/** Limits last read from another machine, by account; kept across visits like the local ones. */
const remoteUsageSnapshots = new Map<string, SubscriptionUsageState>();

/**
 * Limits of accounts this computer is not signed in to, read from the first machine that reports
 * them. A machine where the account is not signed in answers `signed-out`, so the next is asked.
 */
function useRemoteUsages(sources: RemoteUsageSource[]) {
  const key = sources
    .map((source) => `${source.id}@${source.hosts.map((host) => host.machineId).join(",")}`)
    .join("\n");
  const latest = useRef(sources);
  useEffect(() => {
    latest.current = sources;
  });
  const [usages, setUsages] = useState<Record<string, SubscriptionUsageState>>(() =>
    Object.fromEntries(
      sources.flatMap((source) => {
        const cached = remoteUsageSnapshots.get(source.id);
        return cached ? [[source.id, cached]] : [];
      }),
    ),
  );
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const read = async (source: RemoteUsageSource) => {
      for (const host of source.hosts) {
        try {
          const { outcome } = await host.connection.requestProvider(
            { kind: "usage", id: source.id },
            crypto.randomUUID(),
          );
          const usage = outcome.status === "ok" ? outcome.usage : undefined;
          if (!usage || usage.status === "signed-out" || usage.status === "error") continue;
          return { usage, loading: false, error: null, from: host.name };
        } catch {
          // Unreachable or too old to say; ask the next machine.
        }
      }
      return null;
    };
    const refresh = () => {
      for (const source of latest.current)
        void read(source).then((state) => {
          if (cancelled || !state) return;
          remoteUsageSnapshots.set(source.id, state);
          setUsages((current) => ({ ...current, [source.id]: state }));
        });
    };
    refresh();
    const timer = setInterval(refresh, AGENT_USAGE_TTL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key]);
  return useMemo(
    () =>
      Object.fromEntries(
        sources.flatMap((source) => (usages[source.id] ? [[source.id, usages[source.id]]] : [])),
      ) as Record<string, SubscriptionUsageState>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, usages],
  );
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
  drafts,
  onDraft,
  onRegister,
  onSnapshot,
  onLabel,
  onUsageHost,
}: {
  machine: Machine;
  hostScope: string;
  subscriptions: LibraryAccount[];
  accountLabels: Record<string, string>;
  usages: Record<string, SubscriptionUsageState>;
  drafts: Record<string, AssignmentChange>;
  onDraft: (
    machineId: string,
    machineName: string,
    engine: SubscriptionEngine,
    currentId: string,
    id: string,
  ) => void;
  onRegister: (machineId: string, target: AssignmentTarget | null) => void;
  onSnapshot: (machineId: string, data: ProviderSnapshot | null) => void;
  onLabel: (id: string, label: string) => void;
  onUsageHost: (machineId: string, connection: DaemonConnection | null) => void;
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
  const usageHost =
    providerMachine.workspaceReady &&
    handle.state?.status === "ready" &&
    !!handle.state.daemon.capabilities?.includes(PROVIDER_USAGE_CAPABILITY)
      ? handle.transport
      : null;
  useEffect(() => {
    onUsageHost(machine.id, usageHost);
    return () => onUsageHost(machine.id, null);
  }, [machine.id, onUsageHost, usageHost]);
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
      drafts={drafts}
      onDraft={onDraft}
      onRegister={onRegister}
      onLabel={onLabel}
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
  drafts,
  onDraft,
  onRegister,
  onLabel,
  unavailable = false,
}: {
  machineId: string;
  name: string;
  icon?: string | null;
  local?: boolean;
  connection: DaemonConnection | null;
  machine: ProviderMachineState;
  cacheKey: string;
  subscriptions: LibraryAccount[];
  accountLabels: Record<string, string>;
  usages: Record<string, SubscriptionUsageState>;
  drafts: Record<string, AssignmentChange>;
  onDraft: (
    machineId: string,
    machineName: string,
    engine: SubscriptionEngine,
    currentId: string,
    id: string,
  ) => void;
  onRegister: (machineId: string, target: AssignmentTarget | null) => void;
  onLabel: (id: string, label: string) => void;
  unavailable?: boolean;
}) {
  const [connecting, setConnecting] = useState<string | null>(null);
  const [accountEpoch, setAccountEpoch] = useState(0);
  const accountChanged = useCallback(() => setAccountEpoch((epoch) => epoch + 1), []);
  const connectingProvider = connecting
    ? machine.data?.providers.find((provider) => provider.id === connecting)
    : undefined;
  const applyAssignments = useCallback<AssignmentTarget>(
    async (changes) => {
      if (!machine.data) throw new Error(`${name} is unavailable.`);
      let snapshot = machine.data;
      for (const change of changes) {
        const activeId =
          snapshot.providers.find(
            (provider) =>
              provider.engine === change.engine && provider.subscription && provider.active,
          )?.id ?? "";
        if (activeId === change.id) continue;
        if (change.id && !snapshot.providers.some((provider) => provider.id === change.id)) {
          const source = subscriptions.find(
            (provider) => provider.id === change.id && provider.engine === change.engine,
          );
          if (!source) throw new Error("Choose an available subscription.");
          snapshot = await machine.execute({
            kind: "save",
            config: libraryConfig(source),
            expectedRevision: snapshot.revision,
          });
        }
        snapshot = await machine.execute({
          kind: "activate",
          engine: change.engine,
          id: change.id || null,
          expectedRevision: snapshot.revision,
        });
      }
    },
    [machine, name, subscriptions],
  );
  useEffect(() => {
    onRegister(machineId, applyAssignments);
    return () => onRegister(machineId, null);
  }, [applyAssignments, machineId, onRegister]);
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
              draftId={drafts[`${machineId}:${engine}`]?.id}
              epoch={accountEpoch}
              onConnect={setConnecting}
              onDraft={onDraft}
              onLabel={onLabel}
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
  machineId,
  machineName,
  engine,
  connection,
  machine,
  cacheKey,
  subscriptions,
  accountLabels,
  usages,
  draftId,
  epoch,
  onConnect,
  onDraft,
  onLabel,
}: {
  machineId: string;
  machineName: string;
  engine: SubscriptionEngine;
  connection: DaemonConnection | null;
  machine: ProviderMachineState;
  cacheKey: string;
  subscriptions: LibraryAccount[];
  accountLabels: Record<string, string>;
  usages: Record<string, SubscriptionUsageState>;
  draftId: string | undefined;
  epoch: number;
  onConnect: (id: string) => void;
  onLabel: (id: string, label: string) => void;
  onDraft: (
    machineId: string,
    machineName: string,
    engine: SubscriptionEngine,
    currentId: string,
    id: string,
  ) => void;
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
  const currentId = active?.id ?? "";
  const selectedId = draftId ?? currentId;
  useEffect(() => {
    if (!connection || !machine.workspaceReady || !active?.installed || !active.enabled) return;
    let cancelled = false;
    requestAccount(connection, active.id, { type: "read" }).then(
      (next) => {
        if (cancelled) return;
        rememberAccount(cacheKey, active.id, next);
        setAccountResult({ connection, providerId: active.id, account: next, failed: false });
        if (next.label) onLabel(active.id, next.label);
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
    onLabel,
  ]);
  const status = !active
    ? null
    : !managed
      ? "Subscription is no longer in your library"
      : checkingFailed
        ? "Could not check sign-in"
        : account?.status === "disconnected"
          ? "Needs sign-in"
          : null;
  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-center">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ProviderIcon provider={engine} />
        {subscriptionEngineLabels[engine]}
      </div>
      <div className="min-w-0">
        <SubscriptionPicker
          label={`${machineName} ${subscriptionEngineLabels[engine]} subscription`}
          engine={engine}
          selectedId={selectedId}
          choices={choices}
          accountLabels={accountLabels}
          usages={usages}
          disabled={!machine.supported || !machine.data || machine.busy}
          onChange={(id) => onDraft(machineId, machineName, engine, currentId, id)}
        />
        {status && draftId === undefined && (
          <p className="mt-1 text-xs text-muted-foreground">{status}</p>
        )}
      </div>
      <div className="sm:w-24 sm:text-right">
        {draftId === undefined && active && managed && account?.status === "disconnected" && (
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

function SubscriptionPicker({
  label,
  engine,
  selectedId,
  choices,
  accountLabels,
  usages,
  disabled,
  onChange,
}: {
  label: string;
  engine: SubscriptionEngine;
  selectedId: string;
  choices: LibraryAccount[];
  accountLabels: Record<string, string>;
  usages: Record<string, SubscriptionUsageState>;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const selected = choices.find((provider) => provider.id === selectedId);
  const unavailable = !!selectedId && !selected;
  const selectedName = selected ? accountName(selected, accountLabels) : null;
  const selectedUsage = selected ? usages[selected.id]?.usage : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          className="group/picker flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-md border bg-background px-2.5 py-1.5 text-left text-sm transition-colors outline-none hover:bg-muted/35 focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 data-[state=open]:bg-muted/45"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-background">
            {unavailable ? (
              <CircleOff className="size-3.5 text-muted-foreground" />
            ) : (
              <ProviderIcon provider={engine} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate font-medium">
                {unavailable ? "Unavailable subscription" : (selectedName ?? "Not assigned")}
              </span>
              {selectedUsage?.planLabel && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {selectedUsage.planLabel}
                </span>
              )}
            </span>
          </span>
          {selectedUsage && <SelectedUsageSummary usage={selectedUsage} />}
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/picker:rotate-180 motion-reduce:transition-none" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-[28rem] max-w-[calc(100vw-2rem)] p-1.5"
      >
        <DropdownMenuRadioGroup
          value={selectedId || "not-assigned"}
          onValueChange={(value) => onChange(value === "not-assigned" ? "" : value)}
        >
          <DropdownMenuRadioItem value="not-assigned" className="gap-3 px-2 py-2.5 pr-8">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-background">
              <CircleOff className="size-3.5 text-muted-foreground" />
            </span>
            <span className="font-medium">Not assigned</span>
          </DropdownMenuRadioItem>
          {unavailable && (
            <DropdownMenuRadioItem value={selectedId} disabled className="gap-3 px-2 py-2.5 pr-8">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-background">
                <CircleOff className="size-3.5 text-muted-foreground" />
              </span>
              <span>
                <span className="block font-medium">Unavailable subscription</span>
                <span className="block text-xs text-muted-foreground">
                  This account is no longer in your library
                </span>
              </span>
            </DropdownMenuRadioItem>
          )}
          {choices.map((provider) => (
            <DropdownMenuRadioItem
              key={provider.id}
              value={provider.id}
              className="items-start gap-3 px-2 py-2.5 pr-8"
              aria-label={`Use ${accountName(provider, accountLabels)}`}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-background">
                <ProviderIcon provider={engine} />
              </span>
              <PickerAccountDetails
                provider={provider}
                accountLabels={accountLabels}
                usage={usages[provider.id]}
              />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SelectedUsageSummary({ usage }: { usage: AgentPlanUsage }) {
  if (usage.status !== "available") return null;
  const window = [...usage.windows]
    .filter((candidate) => candidate.usedPercent !== null)
    .sort((a, b) => (b.usedPercent ?? 0) - (a.usedPercent ?? 0))[0];
  if (!window) return null;
  const tone = usageTone(window.usedPercent);
  return (
    <span className="hidden w-36 shrink-0 md:block">
      <span className="flex items-baseline justify-between gap-1 text-[10px] text-muted-foreground">
        <span className="truncate">{window.label}</span>
        <span className="shrink-0 whitespace-nowrap tabular-nums">
          {percentLabel(window.usedPercent)}
        </span>
      </span>
      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full",
            tone ? usageBarColors[tone] : "bg-transparent",
          )}
          style={{ width: `${Math.min(100, Math.max(0, window.usedPercent ?? 0))}%` }}
        />
      </span>
    </span>
  );
}

function PickerAccountDetails({
  provider,
  accountLabels,
  usage: state,
}: {
  provider: LibraryAccount;
  accountLabels: Record<string, string>;
  usage: SubscriptionUsageState | undefined;
}) {
  const name = accountName(provider, accountLabels);
  const accountLabel = accountLabels[provider.id] ?? provider.accountLabel;
  const detail = accountLabel && !name.includes(accountLabel) ? accountLabel : null;
  const usage = state?.usage;
  return (
    <span className="min-w-0 flex-1">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate font-medium">{name}</span>
        {usage?.planLabel && (
          <span className="shrink-0 text-xs text-muted-foreground">{usage.planLabel}</span>
        )}
      </span>
      {detail && (
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail}</span>
      )}
      <PickerUsage usage={state} />
    </span>
  );
}

function PickerUsage({ usage: state }: { usage: SubscriptionUsageState | undefined }) {
  if (!state || (!state.usage && state.loading))
    return <span className="mt-2 block h-5 rounded bg-muted/60 motion-safe:animate-pulse" />;
  const usage = state.usage;
  if (!usage || usage.status !== "available" || !usage.windows.length) return null;
  return (
    <span className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
      {usage.windows.map((measured) => {
        const window = currentWindow(measured);
        const tone = usageTone(window.usedPercent);
        const reset = resetLabel(window.resetsAt);
        return (
          <span key={window.id} className="min-w-0">
            <span className="flex items-baseline justify-between gap-1 text-[10px]">
              <span className="truncate text-muted-foreground">{window.label}</span>
              <span className="shrink-0 tabular-nums">{percentLabel(window.usedPercent)}</span>
            </span>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
              <span
                className={cn(
                  "block h-full rounded-full",
                  tone ? usageBarColors[tone] : "bg-transparent",
                )}
                style={{ width: `${Math.min(100, Math.max(0, window.usedPercent ?? 0))}%` }}
              />
            </span>
            {reset && (
              <span className="mt-1 block truncate text-[9px] text-muted-foreground">{reset}</span>
            )}
          </span>
        );
      })}
    </span>
  );
}

function SubscriptionLibraryRow({
  connection,
  entry,
  provider,
  localSupported,
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
  entry: LibraryAccount;
  /** The account as this computer holds it; absent until it is set up here. */
  provider: ProviderStatus | undefined;
  localSupported: boolean;
  account: AgentAccount | undefined;
  epoch: number;
  busy: boolean;
  workspaceReady: boolean;
  usedOn: AssignedMachine[];
  usage: SubscriptionUsageState | undefined;
  usageSupported: boolean;
  onAccount: (id: string, account: AgentAccount) => void;
  onConnect: () => void;
  onRename: (entry: LibraryAccount, name: string | undefined) => Promise<unknown>;
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
  const usable = !!provider?.installed && !!provider.enabled;
  useEffect(() => {
    if (!connection || !workspaceReady || !usable) return;
    let cancelled = false;
    requestAccount(connection, entry.id, { type: "read" }).then(
      (next) => {
        if (cancelled) return;
        onAccount(entry.id, next);
        setFailure(null);
      },
      () => {
        if (!cancelled && !accountRef.current)
          setFailure({ connection, providerId: entry.id, epoch });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [connection, entry.id, usable, epoch, onAccount, workspaceReady]);
  const failed =
    failure?.connection === connection &&
    failure.providerId === entry.id &&
    failure.epoch === epoch;
  const connected = !!provider && account?.status === "connected";
  const name = accountName(entry, account?.label ? { [entry.id]: account.label } : {});
  const { accountNickname: _, ...unnamed } = entry;
  const status = !provider
    ? "Not set up on this computer"
    : !provider.installed
      ? "Not installed on this machine"
      : !provider.enabled
        ? "Disabled on this machine"
        : failed
          ? "Could not check the sign-in"
          : !account
            ? "Checking sign-in…"
            : connected
              ? `Connected${account.label && account.label !== name ? ` · ${account.label}` : ""}`
              : "Not connected";
  const checkingAccount = usable && !account && !failed;
  // Not signed in here: limits read from a machine that is.
  const remoteUsage =
    !(usageSupported && (connected || checkingAccount)) && usage?.from ? usage : undefined;
  return (
    <div
      role="group"
      aria-label={`${subscriptionEngineLabels[entry.engine]} subscription ${name}`}
      className="flex flex-wrap items-start gap-3 px-4 py-3"
    >
      <ProviderIcon provider={entry.engine} />
      <div className="min-w-0 flex-1 basis-32">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="font-medium">{name}</p>
          {usage?.usage?.planLabel && (
            <span className="text-xs text-muted-foreground">{usage.usage.planLabel}</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          <span>{status}</span>
          {!!usedOn.length && (
            <>
              <span aria-hidden="true">·</span>
              <MachineAssignmentsHover machines={usedOn} />
            </>
          )}
          {remoteUsage && (
            <>
              <span aria-hidden="true">·</span>
              <span>Usage from {remoteUsage.from}</span>
            </>
          )}
        </div>
        {usageSupported && (connected || checkingAccount) ? (
          <SubscriptionUsage usage={connected ? usage : undefined} />
        ) : (
          remoteUsage && <SubscriptionUsage usage={remoteUsage} />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {(usable || (!provider && localSupported)) && (
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
          name={entry.accountNickname ?? ""}
          fallbackName={accountName(unnamed, account?.label ? { [entry.id]: account.label } : {})}
          onSave={(nextName) => onRename(entry, nextName)}
          onClose={() => setRenaming(false)}
        />
      )}
    </div>
  );
}

function MachineAssignmentsHover({ machines }: { machines: AssignedMachine[] }) {
  const label = `Used on ${machines.length} machine${machines.length === 1 ? "" : "s"}`;
  return (
    <HoverCard openDelay={180} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${machines.map((machine) => machine.name).join(", ")}`}
          className="rounded-sm underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        >
          {label}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" side="top" sideOffset={6} className="w-60 p-2">
        <p className="px-1 pb-1.5 text-xs font-medium">Assigned machines</p>
        <ul className="space-y-0.5">
          {machines.map((machine) => (
            <li key={machine.id} className="flex items-center gap-2 rounded-md px-1 py-1.5 text-sm">
              <MachineIcon
                local={machine.local}
                icon={machine.icon}
                className="size-4 text-muted-foreground"
              />
              <span className="min-w-0 truncate">{machine.name}</span>
            </li>
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
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
      {usage.windows.map((measured) => {
        const window = currentWindow(measured);
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
  onCreated: (config: ProviderConfig) => void;
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
      onCreated(config);
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
                  // The sign-in page asks for the code, so have it on the clipboard there.
                  if (challenge.code)
                    void copyText(challenge.code).then(
                      () => setCopied(true),
                      () => undefined,
                    );
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
