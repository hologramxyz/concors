import { useCallback, useContext, useSyncExternalStore } from "react";
import type { TerminalInfo } from "@concors/protocol";
import { TerminalConnectionContext } from "./connection-context";

const EMPTY: readonly TerminalInfo[] = [];
export function useTerminalSessions(): readonly TerminalInfo[] {
  const connection = useContext(TerminalConnectionContext);
  return useSyncExternalStore(
    useCallback(
      (listener: () => void) =>
        connection?.subscribeTerminalSessions(listener) ?? (() => undefined),
      [connection],
    ),
    useCallback(() => connection?.terminals ?? EMPTY, [connection]),
    () => EMPTY,
  );
}
