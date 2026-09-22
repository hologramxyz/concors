import { useContext, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { ProviderVersion } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Button } from "@/components/ui/button";
import { invalidateModelCatalogs } from "./model-catalog";

/** Whether a provider row should advertise an update, including one still in progress. */
function providerUpdatePending(version: ProviderVersion | undefined): boolean {
  return !!version && (version.updateAvailable || !!version.updating || !!version.updateError);
}

/**
 * Tells the user their agent CLI has a newer release, since new models often need it, and runs
 * the machine's update command when the daemon knows one. The daemon reports progress through
 * the provider list, which this polls until the update settles.
 */
export function ProviderUpdateNotice({
  provider,
  label,
  version,
}: {
  provider: string;
  label: string;
  version: ProviderVersion;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [live, setLive] = useState<ProviderVersion | null>(null),
    [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const current = live ?? version;
  if (!providerUpdatePending(current)) return null;
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
  return (
    <div role="status" className="border-t px-2 py-2 text-xs text-muted-foreground">
      {current.updating ? (
        <p className="flex items-center gap-1.5">
          <LoaderCircle className="size-3.5 animate-spin" /> Updating {label}…
        </p>
      ) : current.updateAvailable ? (
        <>
          <p>
            {label} {current.latest} is available. Update to get the latest models.
          </p>
          {current.updateCommand ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              title={`Installed: ${current.installed}. Runs on this machine: ${current.updateCommand}`}
              onClick={() => void update()}
            >
              Update
            </Button>
          ) : (
            <p className="mt-1">Update it the way you installed it.</p>
          )}
        </>
      ) : null}
      {(error ?? current.updateError) && (
        <p role="alert" className="mt-1 text-destructive">
          {error ?? current.updateError}
        </p>
      )}
    </div>
  );
}
