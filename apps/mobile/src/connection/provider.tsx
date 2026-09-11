import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AppState, Platform } from "react-native";
import * as Network from "expo-network";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import {
  ConnectionController,
  createManagedConnection,
  type ConnectionSnapshot,
  parseHosts,
  HostSchema,
} from "@concors/client-core";
import { deviceStorage, machineCredentials } from "../platform/storage";
import { config } from "../config";
import { api, demo } from "../auth/runtime";

interface MachineContextValue {
  machineId: string | null;
  selectMachine(id: string | null): void;
  connection: ConnectionSnapshot;
  retry(): void;
}
const idle: ConnectionSnapshot = {
  phase: "idle",
  transport: null,
  workspace: null,
  agents: [],
  terminals: [],
  message: null,
};
const MachineContext = createContext<MachineContextValue | null>(null);
export function useMachine() {
  const value = useContext(MachineContext);
  if (!value) throw new Error("Missing MachineProvider");
  return value;
}
/** SecureStore keys only allow [A-Za-z0-9._-], so the scope is hex-encoded. */
function scopedKey(prefix: string, scope: string) {
  return `${prefix}.${Array.from(scope, (char) => char.charCodeAt(0).toString(16)).join("-")}`;
}
async function createConnection(machineId: string | null, scope: string, signal: AbortSignal) {
  const client = {
    kind: "mobile" as const,
    name: "concors-mobile",
    version: "0.1.0",
    platform: Platform.OS,
  };
  if (demo)
    return new DaemonConnection({
      endpoint: describeDaemonEndpoint("wss://demo.concors.invalid/ws"),
      client,
      webSocketFactory: (await demo).socket,
    });
  if (config.developmentDaemon) {
    return new DaemonConnection({
      endpoint: describeDaemonEndpoint(config.developmentDaemon),
      client,
    });
  }
  if (!machineId) throw new Error("Choose a machine first.");
  const key = scopedKey("hosts.v1", scope);
  const hosts = parseHosts(await deviceStorage.get(key));
  if (signal.aborted) throw new Error("Connection cancelled");
  return createManagedConnection(api, machineId, client, {
    scope,
    signal,
    credentials: machineCredentials,
    savedHost: hosts.find((host) => host.machineId === machineId),
    saveHost: (host) =>
      deviceStorage.set(
        key,
        JSON.stringify([
          ...hosts.filter((saved) => saved.machineId !== host.machineId),
          HostSchema.parse(host),
        ]),
      ),
  });
}
export function MachineProvider({
  children,
  scope,
  direct = false,
  enabled,
}: {
  children: ReactNode;
  scope: string;
  direct?: boolean;
  enabled: boolean;
}) {
  const [selection, setSelection] = useState<{ scope: string; id: string | null } | null>(null);
  const machineId = selection?.scope === scope ? selection.id : null;
  const selectMachine = useCallback(
    (id: string | null) => {
      setSelection({ scope, id });
      void deviceStorage.set(scopedKey("selected-machine.v1", scope), id).catch(() => undefined);
    },
    [scope],
  );
  // Restore the machine picked before the last launch; an explicit pick made while the
  // read is in flight wins.
  useEffect(() => {
    let cancelled = false;
    void deviceStorage
      .get(scopedKey("selected-machine.v1", scope))
      .then((id) => {
        if (cancelled || !id) return;
        setSelection((current) => (current?.scope === scope ? current : { scope, id }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scope]);
  return (
    <MachineSession
      key={scope}
      scope={scope}
      machineId={machineId}
      selectMachine={selectMachine}
      direct={direct}
      enabled={enabled}
    >
      {children}
    </MachineSession>
  );
}
function MachineSession({
  scope,
  children,
  machineId,
  selectMachine,
  direct,
  enabled,
}: {
  children: ReactNode;
  scope: string;
  machineId: string | null;
  selectMachine(id: string | null): void;
  direct: boolean;
  enabled: boolean;
}) {
  const controller = useMemo(
    () =>
      enabled && (direct || machineId)
        ? new ConnectionController(
            (signal) => createConnection(machineId, scope, signal),
            // Managed cloud IDs are token audiences; workspace IDs are a separate daemon namespace.
            config.demo ? (machineId ?? undefined) : undefined,
          )
        : null,
    [machineId, scope, direct, enabled],
  );
  const connection = useSyncExternalStore(
    controller?.subscribe ?? noSubscribe,
    controller?.getSnapshot ?? getIdle,
    getIdle,
  );
  useEffect(() => {
    if (!controller) return;
    let active = AppState.currentState !== "background" && AppState.currentState !== "inactive";
    let online = true;
    let disposed = false;
    const update = () => {
      if (!disposed) controller.setAvailable(active && (online || config.demo));
    };
    const app = AppState.addEventListener("change", (state) => {
      active = state === "active";
      update();
    });
    const network = Network.addNetworkStateListener((state) => {
      online = state.isConnected !== false && state.isInternetReachable !== false;
      update();
    });
    void Network.getNetworkStateAsync()
      .then((state) => {
        online = state.isConnected !== false && state.isInternetReachable !== false;
        update();
      })
      .catch(update);
    update();
    // Pause also makes React's development effect replay safe; the abandoned controller
    // has no socket, timer, or subscription keeping it alive after unmount.
    return () => {
      disposed = true;
      app.remove();
      network.remove();
      controller.setAvailable(false);
    };
  }, [controller]);
  return (
    <MachineContext
      value={{
        machineId: direct ? (connection.workspace?.machineId ?? null) : machineId,
        selectMachine,
        connection,
        retry: controller?.retry ?? noop,
      }}
    >
      {children}
    </MachineContext>
  );
}
function noop() {
  /* No selected connection. */
}
function noSubscribe() {
  return noop;
}
function getIdle() {
  return idle;
}
