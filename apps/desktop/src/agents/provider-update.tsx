import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CircleArrowUp, LoaderCircle } from "lucide-react";
import { Popover } from "radix-ui";
import { agentProviderName, type AgentInfo, type ProviderVersion } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Button } from "@/components/ui/button";
import { invalidateModelCatalogs, modelCatalog } from "./model-catalog";
import { ComposerSurfaceContext } from "./composer-expansion";

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
  className = "border-t",
}: {
  provider: string;
  label: string;
  version: ProviderVersion;
  className?: string;
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

const noProviders = () => [];
const noSubscription = () => () => undefined;

/**
 * A quiet label beside the composer's send controls while the conversation's CLI is outdated,
 * like Claude Code's own "update available" hint. It reads the catalog the model picker already
 * keeps warm, so it never starts discovery itself.
 */
export function ProviderUpdateLabel({ agent, compact }: { agent: AgentInfo; compact: boolean }) {
  const connection = useContext(TerminalConnectionContext);
  const composerSurface = useContext(ComposerSurfaceContext);
  const epoch = connection?.workspace?.epoch;
  const catalog = useMemo(
    () => (connection ? modelCatalog(connection, agent.directory, epoch) : null),
    [connection, agent.directory, epoch],
  );
  const snapshot = useSyncExternalStore(
    catalog?.subscribe ?? noSubscription,
    catalog ? () => catalog.getSnapshot().providers : noProviders,
  );
  const row = snapshot.find((p) => p.id === agent.provider);
  const version = row?.version;
  if (!version?.updateAvailable && !version?.updating) return null;
  const label = agent.providerLabel ?? row?.label ?? agentProviderName(agent.provider);
  const text = version.updating
    ? `Updating ${label}…`
    : compact
      ? "Update available"
      : `${label} ${version.latest} available`;
  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        aria-label={text}
        title={`${label} ${version.latest} is available`}
        className="composer-update-label inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-1 text-xs whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {/* A narrow desktop composer keeps only the icon, so the controls stay on one row. */}
        {!compact &&
          (version.updating ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <CircleArrowUp className="size-3.5 shrink-0" aria-hidden="true" />
          ))}
        <span className="truncate">{text}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          data-composer-surface={composerSurface}
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-64 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          <ProviderUpdateNotice
            provider={agent.provider}
            label={label}
            version={version}
            className=""
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
