import type { Machine } from "@concors/api-client";
import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeMachinesError } from "./use-machines";

export function DevelopmentToolsStatus({
  machine,
  onRetry,
}: {
  readonly machine: Machine;
  readonly onRetry: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setup = machine.developmentToolsSetup;
  if (!setup || machine.status === "provisioning") return null;
  return (
    <section
      aria-label="Development tools"
      className="mt-5 border-t pt-4 text-xs text-muted-foreground"
    >
      {setup.status === "ready" ? (
        <p>
          Development tools ready ·{" "}
          {Object.entries(setup.versions)
            .map(([name, version]) => `${name} ${version}`)
            .join(" · ") || "Git and basic utilities"}
        </p>
      ) : setup.status === "error" ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status">{setup.error ?? "Development tools could not be installed."}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={pending || machine.status !== "running"}
            onClick={() => {
              setPending(true);
              setError(null);
              void onRetry()
                .catch((cause) => setError(describeMachinesError(cause)))
                .finally(() => setPending(false));
            }}
          >
            {pending ? "Retrying…" : "Retry setup"}
          </Button>
        </div>
      ) : (
        <p role="status" className="flex items-center gap-2">
          <LoaderCircle
            className="size-3 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {setup.status === "installing"
            ? "Installing development tools…"
            : "Development tools queued for setup…"}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
