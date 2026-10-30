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
  const [live, setLive] = useState<ProviderVersion | null>(null),
    [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const update = async () => {
    if (!connection) return;
    setError(null);
    try {
      const request = async (operation: { kind: "update"; id: string } | { kind: "list" }) => {
        const result = await connection.requestProvider(operation, crypto.randomUUID());
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        return result.outcome.providers.find((p) => p.id === provider)?.version;
      };
      const poll = (next: ProviderVersion | undefined) => {
        setLive(next ?? null);
        if (next?.updating)
          timer.current = window.setTimeout(() => {
            request({ kind: "list" }).then(poll, (e: Error) => setError(e.message));
          }, 2000);
        // A new CLI can report new models; drop cached catalogs so they are rediscovered.
        else invalidateModelCatalogs(connection);
      };
      poll(await request({ kind: "update", id: provider }));
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not update ${label}`);
    }
  };
  return { version: live ?? version, error: error ?? (live ?? version)?.updateError, update };
}
