import { ArrowUpCircle, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { APP_VERSION } from "@/version";
import { cn } from "cn";

import { useAppUpdate, type AppUpdateControls, type AppUpdateState } from "./app-update.ts";

/**
 * Sits above the account menu and appears only when a newer Concors is published. Clicking it
 * shows what changed and, where this copy can be replaced, installs it and restarts.
 *
 * Installing ends local terminals and agent sessions: the new build brings its own daemon, and the
 * session host is replaced when the daemon behind it changes (docs/session-recovery.md). That is
 * said plainly here rather than discovered afterwards.
 */
export function UpdateBadge({
  collapsed = false,
  controls,
}: {
  collapsed?: boolean;
  /** Injected by tests; the app uses the shared hook. */
  controls?: AppUpdateControls;
}) {
  const live = useAppUpdate();
  const { state, install } = controls ?? live;
  const [open, setOpen] = useState(false);

  if (state.kind === "none") return null;

  const busy = state.kind === "installing";
  const label = busy ? "Installing the update" : `Update to Concors ${state.update.version}`;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger
            aria-label={label}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-2 text-ui text-sidebar-foreground hover:bg-sidebar-accent",
              collapsed && "sidebar-rail-control justify-center px-0",
            )}
          >
            {busy ? (
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowUpCircle className="size-4 shrink-0 text-primary" aria-hidden="true" />
            )}
            {!collapsed && (
              <span className="flex-1 truncate text-left">
                {busy ? "Installing…" : `Update to ${state.update.version}`}
              </span>
            )}
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side={collapsed ? "right" : "top"} sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Concors {state.update.version} is available</DialogTitle>
          <DialogDescription>
            You are running {APP_VERSION}. Released {releaseDate(state.update.publishedAt)}.
          </DialogDescription>
        </DialogHeader>
        <UpdateBody state={state} onInstall={install} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function UpdateBody({
  state,
  onInstall,
  onClose,
}: {
  state: Exclude<AppUpdateState, { kind: "none" }>;
  onInstall: () => Promise<void>;
  onClose: () => void;
}) {
  const installable = state.kind === "installing" || state.installable;
  return (
    <div className="space-y-4">
      {state.update.notes && (
        <p className="text-ui whitespace-pre-wrap text-muted-foreground">{state.update.notes}</p>
      )}

      {installable ? (
        <p className="text-ui text-muted-foreground">
          Terminals and agent sessions on this computer close while Concors restarts. Projects,
          history and settings are kept.
        </p>
      ) : (
        <p className="text-ui text-muted-foreground">
          This copy of Concors was not installed in a way it can replace on its own. Update it the
          same way you installed it.
        </p>
      )}

      {state.kind === "failed" && (
        <p className="text-ui text-destructive" role="alert">
          {state.message}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={state.kind === "installing"}>
          {installable ? "Not now" : "Close"}
        </Button>
        {installable && (
          <Button onClick={() => void onInstall()} disabled={state.kind === "installing"}>
            {state.kind === "installing"
              ? "Installing…"
              : state.kind === "failed"
                ? "Try again"
                : "Update and restart"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** A plain date; the exact minute of a release is not useful to anyone deciding to update. */
function releaseDate(published: string): string {
  const date = new Date(published);
  return Number.isNaN(date.getTime())
    ? "recently"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}
