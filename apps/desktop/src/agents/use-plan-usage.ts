import { useContext, useSyncExternalStore } from "react";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { noPlanUsage, planUsageStore, type PlanUsageState } from "./plan-usage";

const empty = new Map<string, PlanUsageState>();
const emptySnapshot = () => empty;
const noSubscription = () => () => undefined;

/** One provider's plan usage, shared by every session of that provider on this machine. */
export function usePlanUsage(provider: string) {
  const connection = useContext(TerminalConnectionContext);
  const store = connection ? planUsageStore(connection) : null;
  const states = useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    store?.getSnapshot ?? emptySnapshot,
  );
  return {
    state: states.get(provider) ?? noPlanUsage,
    supported: store?.supported ?? false,
    refresh: (sessionId: string, force = false) => store?.refresh(provider, sessionId, force),
  };
}
