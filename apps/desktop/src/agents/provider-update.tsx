import { useState } from "react";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { providerPresets, type ProviderVersion } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/tauri/open-external";
import { ControlTooltip } from "./control-tooltip";
import { providerUpdatePending, useProviderUpdate } from "./provider-update-state";

/**
 * Sits under a provider's model list while its CLI has a newer release, since new models often
 * need it. Update runs the machine's update command; without one the CLI was installed some way
 * the daemon cannot repeat, so the button opens the vendor's guide instead. The update itself is
 * owned by the caller, so it keeps going after the menu closes.
 */
export function ProviderUpdateFooter({
  provider,
  label,
  version,
  error,
  onUpdate,
}: {
  /** The provider's engine or ID, which names its vendor guide. */
  provider: string;
  label: string;
  version: ProviderVersion | undefined;
  error: string | null | undefined;
  onUpdate: () => void;
}) {
  const [guideError, setGuideError] = useState<string | null>(null);
  if (!version || !providerUpdatePending(version)) return null;
  const guide = providerPresets.find((p) => p.id === provider)?.installLink;
  const command = !!version.updateCommand;
  const message = error ?? guideError;
  return (
    <div role="status" className="mt-1 border-t px-2 pt-2 pb-0.5 text-xs text-muted-foreground">
      <div className="flex min-h-7 items-center gap-2">
        <p className="min-w-0 flex-1 truncate">
          {version.updating
            ? `Updating ${label}…`
            : version.latest
              ? `Update to ${version.latest}`
              : `${label} has an update`}
        </p>
        {version.updating ? (
          <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          version.updateAvailable &&
          (command || guide) && (
            <ControlTooltip
              text={
                command
                  ? `Update ${label} · installed: ${version.installed ?? "unknown"}`
                  : `Opens ${label}'s guide. Update it the way you installed it.`
              }
            >
              <Button
                size="sm"
                onClick={() => {
                  setGuideError(null);
                  if (command) onUpdate();
                  else if (guide)
                    void openExternal(guide).catch(() =>
                      setGuideError("Could not open the update guide."),
                    );
                }}
              >
                Update
                {!command && <ExternalLink className="size-3" aria-hidden="true" />}
              </Button>
            </ControlTooltip>
          )
        )}
      </div>
      {version.updateAvailable && !version.updating && !command && !guide && (
        <p className="mt-0.5">Update it the way you installed it.</p>
      )}
      {message && (
        <p role="alert" className="mt-1 text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

/** The footer for a provider other than the selected agent's, which runs its own update. */
export function ProviderUpdateNotice({
  id,
  provider,
  label,
  version,
}: {
  id: string;
  provider: string;
  label: string;
  version: ProviderVersion;
}) {
  const current = useProviderUpdate(id, label, version);
  return (
    <ProviderUpdateFooter
      provider={provider}
      label={label}
      version={current.version}
      error={current.error}
      onUpdate={() => void current.update()}
    />
  );
}
