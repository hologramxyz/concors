import type { ConnectionState, DaemonEndpoint } from "@concors/daemon-client";
import { ChevronDown, RefreshCw } from "lucide-react";
import { cn } from "cn";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ConnectionStatusProps {
  readonly state: ConnectionState;
  readonly endpoint: DaemonEndpoint | null;
  readonly onReconnect: () => void;
}

type Tone = "ok" | "busy" | "bad" | "idle";

const DOT_CLASS: Record<Tone, string> = {
  ok: "bg-success",
  busy: "bg-warning animate-pulse",
  bad: "bg-destructive",
  idle: "bg-muted-foreground/50",
};

/** Daemon connection pill for the top bar. Click for details and a reconnect action. */
export function ConnectionStatus({ state, endpoint, onReconnect }: ConnectionStatusProps) {
  const { label, tone } = describe(state);
  const canReconnect = state.status === "disconnected" || state.status === "error";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="font-normal text-muted-foreground"
          aria-label={`Daemon connection: ${label}`}
        >
          <span
            aria-hidden="true"
            className={cn("size-1.5 rounded-full", DOT_CLASS[tone])}
            role="status"
          />
          <span className="text-foreground">{label}</span>
          {endpoint !== null && (
            <Badge
              variant="outline"
              className="h-5 px-1 text-xs tracking-wide text-muted-foreground uppercase"
            >
              {endpoint.kind}
            </Badge>
          )}
          <ChevronDown className="size-3 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Daemon
        </DropdownMenuLabel>
        <div className="selectable space-y-1.5 px-2 pb-2 text-xs">
          <Row label="Status" value={label} />
          <Row label="Endpoint" value={endpoint?.url ?? "resolving…"} mono />
          {state.status === "ready" && (
            <>
              <Row label="Version" value={state.daemon.daemonVersion} mono />
              <Row label="Protocol" value={state.daemon.protocolVersion} mono />
            </>
          )}
          {state.status === "error" && (
            <Row label="Error" value={`${state.error.code} — ${state.error.message}`} />
          )}
          {state.status === "disconnected" && state.reason !== undefined && (
            <Row label="Reason" value={state.reason} />
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onReconnect} disabled={!canReconnect}>
          <RefreshCw aria-hidden="true" />
          Reconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("truncate text-right", mono && "font-mono")} title={value}>
        {value}
      </span>
    </div>
  );
}

function describe(state: ConnectionState): { label: string; tone: Tone } {
  switch (state.status) {
    case "ready":
      return { label: "Connected", tone: "ok" };
    case "connecting":
      return { label: "Connecting…", tone: "busy" };
    case "handshaking":
      return { label: "Handshaking…", tone: "busy" };
    case "error":
      return { label: "Connection error", tone: "bad" };
    case "disconnected":
      return { label: "Disconnected", tone: "idle" };
  }
}
