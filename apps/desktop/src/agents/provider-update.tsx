import { LoaderCircle } from "lucide-react";
import type { ProviderVersion } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import { ControlTooltip } from "./control-tooltip";
import { providerUpdatePending, useProviderUpdate } from "./provider-update-state";

/**
 * Tells the user their agent CLI has a newer release, since new models often need it, and runs
 * the machine's update command when the daemon knows one.
 */
export function ProviderUpdateNotice({
  provider,
  label,
  version,
  className = "border-t",
}: {
  provider: string;
  label: string;
  version: ProviderVersion;
  className?: string;
}) {
  const { version: current, error, update } = useProviderUpdate(provider, label, version);
  if (!current || !providerUpdatePending(current)) return null;
  return (
    <div role="status" className={`${className} px-2 py-2 text-xs text-muted-foreground`}>
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
            <ControlTooltip text={`Update ${label} · installed: ${current.installed}`}>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => void update()}>
                Update
              </Button>
            </ControlTooltip>
          ) : (
            <p className="mt-1">Update it the way you installed it.</p>
          )}
        </>
      ) : null}
      {error && (
        <p role="alert" className="mt-1 text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
