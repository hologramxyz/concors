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
import { ConnectionController, type ConnectionSnapshot } from "@concors/client-core";
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
async function createConnection(machineId: string) {
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
    const url = new URL(config.developmentDaemon);
    if (url.protocol !== "wss:" || url.username || url.password || url.search || url.hash)
      throw new Error("The development gateway requires a clean WSS URL.");
    return new DaemonConnection({ endpoint: describeDaemonEndpoint(url.href), client });
  }
  const ticket = await api.connectMachine(machineId);
  return new DaemonConnection({
    endpoint: describeDaemonEndpoint(ticket.url),
    client,
    webSocketFactory: (url) => new WebSocket(url, ["concors.v1", `ticket.${ticket.ticket}`]),
  });
}
export function MachineProvider({ children, scope }: { children: ReactNode; scope: string }) {
  const [selection, setSelection] = useState<{ scope: string; id: string | null } | null>(null);
  const machineId = selection?.scope === scope ? selection.id : null;
  const selectMachine = useCallback((id: string | null) => setSelection({ scope, id }), [scope]);
  return (
    <MachineSession machineId={machineId} selectMachine={selectMachine}>
      {children}
    </MachineSession>
  );
}
function MachineSession({
  children,
  machineId,
  selectMachine,
}: {
  children: ReactNode;
  machineId: string | null;
  selectMachine(id: string | null): void;
}) {
  const controller = useMemo(
    () =>
      machineId
        ? new ConnectionController(
            () => createConnection(machineId),
            config.developmentDaemon ? undefined : machineId,
          )
        : null,
    [machineId],
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
      value={{ machineId, selectMachine, connection, retry: controller?.retry ?? noop }}
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
