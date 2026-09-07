import type { ConnectionState } from "@concors/daemon-client";
import { Bot } from "lucide-react";

import { Kbd } from "@/components/ui/kbd";
import { modShortcut } from "@/lib/platform";

interface HomeViewProps {
  readonly state: ConnectionState;
}

/** Empty state. Agent sessions will replace this once the daemon can run them. */
export function HomeView({ state }: HomeViewProps) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="mb-4 flex size-10 items-center justify-center rounded-lg border bg-card text-muted-foreground shadow-xs">
          <Bot className="size-5" aria-hidden="true" />
        </div>
        <h1 className="text-[15px] font-semibold">No agent sessions yet</h1>
        <p className="mt-1.5 text-muted-foreground">
          {state.status === "ready"
            ? "Connected to your daemon. Starting and orchestrating coding agents is the next thing to land here."
            : "Waiting for a daemon. In development, start one with "}
          {state.status !== "ready" && (
            <code className="selectable rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">
              pnpm daemon:dev
            </code>
          )}
        </p>
        <p className="mt-5 flex items-center gap-1.5 text-xs text-muted-foreground">
          Press <Kbd>{modShortcut("K")}</Kbd> to search and run commands
        </p>
      </div>
    </div>
  );
}
