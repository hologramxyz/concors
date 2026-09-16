import { useCallback, useContext, useSyncExternalStore } from "react";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { EMPTY_PROCESSES, processStore } from "./process-store";

export function useProcesses(enabled = true) {
  const connection = useContext(TerminalConnectionContext);
  const store = connection && enabled ? processStore(connection) : null;
  const subscribe = useCallback(
    (listener: () => void) => store?.subscribe(listener) ?? (() => undefined),
    [store],
  );
  const getSnapshot = useCallback(() => store?.getSnapshot() ?? EMPTY_PROCESSES, [store]);
  const state = useSyncExternalStore(subscribe, getSnapshot);
  return { ...state, connection, refresh: () => store?.refresh() };
}
