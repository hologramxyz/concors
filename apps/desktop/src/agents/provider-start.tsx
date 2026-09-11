import { useContext, useEffect, useState } from "react";
import type { ProviderStatus } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { ProviderIcon } from "./provider-icon";
import { Button } from "@/components/ui/button";

export function ProviderStart({
  disabled,
  onChoose,
}: {
  disabled: boolean;
  onChoose: (provider: string) => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    void connection
      .requestProvider({ kind: "list" }, crypto.randomUUID())
      .then((result) => {
        if (cancelled) return;
        if (result.outcome.status === "error") setError(result.outcome.message);
        else setProviders(result.outcome.providers.filter((p) => p.enabled && p.installed));
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);
  return (
    <div className="mx-auto w-full max-w-xl space-y-4 p-5">
      <h2 className="text-base font-medium">Choose an agent</h2>
      <p className="text-sm text-muted-foreground">
        Start a conversation with an installed CLI using your account.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {providers?.map((p) => (
          <Button key={p.id} variant="outline" disabled={disabled} onClick={() => onChoose(p.id)}>
            <ProviderIcon provider={p.id} />
            {p.label}
          </Button>
        ))}
      </div>
      {providers === null && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          Checking this machine…
        </p>
      )}
      {providers && (
        <p className="text-sm text-muted-foreground">
          {!providers.length ? "No enabled agent is installed. " : "Missing a provider? "}Install or
          configure agents in Settings → Providers.
        </p>
      )}
    </div>
  );
}
