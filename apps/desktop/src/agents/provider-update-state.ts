import { useContext, useEffect, useRef, useState } from "react";
import type { ProviderVersion } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { invalidateModelCatalogs } from "./model-catalog";

/** Whether a provider row should advertise an update, including one still in progress. */
export function providerUpdatePending(version: ProviderVersion | undefined): boolean {
  return !!version && (version.updateAvailable || !!version.updating || !!version.updateError);
}

/**
 * Runs the machine's update command for one provider's CLI. The daemon reports progress through
 * the provider list, which this polls until the update settles; the returned version is that live
 * state once an update has started, and the catalog's until then.
 */
export function useProviderUpdate(
  provider: string,
  label: string,
  version: ProviderVersion | undefined,
) {
  const connection = useContext(TerminalConnectionContext);
  // By provider: the phone's model menu keeps this one hook across its pages.
  const [live, setLive] = useState<Record<string, ProviderVersion | null>>({}),
    [errors, setErrors] = useState<Record<string, string | null>>({});
  const timers = useRef(new Set<number>());
  useEffect(() => {
    const running = timers.current;
    return () => running.forEach((timer) => window.clearTimeout(timer));
  }, []);
  const update = async () => {
    if (!connection) return;
    const setError = (message: string | null) =>
      setErrors((known) => ({ ...known, [provider]: message }));
    setError(null);
    try {
      const request = async (operation: { kind: "update"; id: string } | { kind: "list" }) => {
        const result = await connection.requestProvider(operation, crypto.randomUUID());
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        return result.outcome.providers.find((p) => p.id === provider)?.version;
      };
      const poll = (next: ProviderVersion | undefined) => {
        setLive((known) => ({ ...known, [provider]: next ?? null }));
        if (next?.updating) {
          const timer = window.setTimeout(() => {
            timers.current.delete(timer);
            request({ kind: "list" }).then(poll, (e: Error) => setError(e.message));
          }, 2000);
          timers.current.add(timer);
        }
        // A new CLI can report new models; drop cached catalogs so they are rediscovered.
        else invalidateModelCatalogs(connection);
      };
      poll(await request({ kind: "update", id: provider }));
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not update ${label}`);
    }
  };
  const current = live[provider] ?? version;
  return { version: current, error: errors[provider] ?? current?.updateError, update };
}
