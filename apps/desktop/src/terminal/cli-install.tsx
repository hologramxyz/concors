import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, LoaderCircle } from "lucide-react";
import type { DaemonConnection } from "@concors/daemon-client";
import type { ProviderOperation, ProviderStatus } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/tauri/open-external";

/**
 * A Codex, Claude Code or OpenCode terminal that could not start because the CLI is missing offers
 * to install it, as an Agent tab does, and starts once it is in. Renders nothing while the daemon
 * cannot say, or when the CLI is installed (the start failed for another reason).
 */
export function TerminalCliInstall({
  connection,
  cliId,
  canEdit,
  onInstalled,
}: {
  connection: DaemonConnection;
  cliId: "codex" | "claude" | "opencode";
  canEdit: boolean;
  onInstalled: () => void;
}) {
  const [cli, setCli] = useState<ProviderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const latest = useRef<ProviderStatus | null>(null);
  const installed = useRef(onInstalled);
  useEffect(() => {
    installed.current = onInstalled;
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const provider = useCallback(
    async (operation: ProviderOperation) => {
      const result = await connection.requestProvider(operation, crypto.randomUUID());
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      const next = result.outcome.providers.find((p) => p.id === cliId) ?? null;
      const before = latest.current;
      latest.current = next;
      if (!mounted.current) return;
      setCli(next);
      if (before && !before.installed && next?.installed) installed.current();
    },
    [connection, cliId],
  );
  const list = useCallback(() => {
    void provider({ kind: "list" }).catch(() => undefined);
  }, [provider]);
  useEffect(() => {
    list();
    // Installed from a terminal meanwhile: coming back to the window notices it.
    window.addEventListener("focus", list);
    return () => window.removeEventListener("focus", list);
  }, [list]);
  const installing = cli?.installStatus === "installing";
  useEffect(() => {
    if (!installing) return;
    const timer = setInterval(list, 2000);
    return () => clearInterval(timer);
  }, [installing, list]);
  if (!cli || cli.installed) return null;
  const failure = error ?? (cli.installStatus === "failed" ? cli.error : undefined);
  return (
    <section
      aria-label={`${cli.label} installation`}
      className="flex flex-col items-center gap-3 text-sm"
    >
      <p className="text-muted-foreground">
        {cli.canInstall
          ? `Concors can install ${cli.label} on this machine for you. It takes about a minute.`
          : `Install ${cli.label} on this machine using its guide, then retry.`}
      </p>
      {failure && (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {cli.canInstall && (
          <Button
            size="sm"
            disabled={!canEdit || installing}
            onClick={() => {
              setError(null);
              void provider({ kind: "install", id: cli.id }).catch((cause: unknown) => {
                if (mounted.current)
                  setError(
                    cause instanceof Error ? cause.message : `Could not install ${cli.label}`,
                  );
              });
            }}
          >
            {installing ? <LoaderCircle className="animate-spin" /> : <Download />}
            {installing ? "Installing…" : `Install ${cli.label}`}
          </Button>
        )}
        {cli.installLink && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => {
              if (cli.installLink)
                void openExternal(cli.installLink).catch(() =>
                  setError("Could not open the installation guide."),
                );
            }}
          >
            Installation guide
            <ExternalLink className="size-3" />
          </Button>
        )}
      </div>
    </section>
  );
}
