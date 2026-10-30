import { X } from "lucide-react";
import { useContext, useEffect } from "react";
import type { TerminalInfo, WorkspaceSnapshot } from "@concors/protocol";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  BackgroundTerminalsContext,
  shownSessions,
  terminalActivity,
} from "./background-terminals";
import { useClosedTerminalNames } from "./closed-names";
import { useTerminalSessions } from "./use-terminal-sessions";

/**
 * How a background terminal is named: what its tab was called, or else what it runs, set apart
 * when it is a command.
 */
function TerminalName({ terminal }: { terminal: TerminalInfo }) {
  const name = useClosedTerminalNames().get(terminal.id);
  if (name) return <>{name}</>;
  const activity = terminalActivity(terminal);
  if (!activity) return <>Terminal</>;
  return terminal.profile === "shell" && !terminal.detectedAgent ? (
    <span className="font-mono">{activity}</span>
  ) : (
    <>{activity}</>
  );
}

/** One line after a close that left a terminal running, so it can be brought back or stopped. */
export function ClosedTerminalNotice({
  terminal,
  workspace,
  onDismiss,
}: {
  terminal: TerminalInfo;
  workspace: Pick<WorkspaceSnapshot, "projects"> | null;
  onDismiss: () => void;
}) {
  const actions = useContext(BackgroundTerminalsContext);
  const live = useTerminalSessions().find((item) => item.id === terminal.id);
  // Gone once the terminal exits or is open in a pane again, from here or anywhere else.
  const background =
    !!live && !!terminalActivity(live) && !shownSessions(workspace).has(terminal.id);
  useEffect(() => {
    if (!background) {
      onDismiss();
      return;
    }
    const timer = setTimeout(onDismiss, 10_000);
    return () => clearTimeout(timer);
  }, [background, onDismiss]);
  if (!background || !actions) return null;
  return (
    <div
      role="status"
      className="fixed top-14 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-md border bg-popover p-3 text-ui shadow-md duration-200 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2"
    >
      <span className="min-w-0 truncate">
        <TerminalName terminal={live} /> is still running
      </span>
      <Button type="button" variant="ghost" onClick={() => actions.reopen(live)}>
        Reopen
      </Button>
      <Button type="button" variant="ghost" onClick={() => actions.stop(live)}>
        Stop
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss"
        className="text-muted-foreground"
        onClick={onDismiss}
      >
        <X />
      </Button>
    </div>
  );
}

/**
 * Every terminal still running without a pane, by workspace, so one can be reopened or stopped.
 * Shells waiting at a prompt are listed too: they count toward the machine's terminal limit.
 */
export function ManageTerminalsDialog({
  open,
  onOpenChange,
  workspace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: Pick<WorkspaceSnapshot, "projects"> | null;
}) {
  const actions = useContext(BackgroundTerminalsContext);
  const shown = shownSessions(workspace);
  const running = useTerminalSessions()
    .filter(
      (terminal) =>
        !shown.has(terminal.id) &&
        (terminal.status === "running" || terminal.status === "starting"),
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const projects = workspace?.projects ?? [];
  const groups = [
    ...projects.map((project) => ({
      key: project.id,
      name: project.name,
      available: true,
      terminals: running.filter((terminal) => terminal.projectId === project.id),
    })),
    {
      key: "unavailable",
      name: "Unavailable workspace",
      available: false,
      terminals: running.filter(
        (terminal) => !projects.some((project) => project.id === terminal.projectId),
      ),
    },
  ].filter((group) => group.terminals.length);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Background terminals</DialogTitle>
          <DialogDescription>Still running after their tab was closed.</DialogDescription>
        </DialogHeader>
        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No terminals are running in the background.
          </p>
        )}
        {groups.map((group) => (
          <section key={group.key} aria-label={group.name} className="space-y-1">
            <h3 className="text-xs font-medium text-muted-foreground">{group.name}</h3>
            <ul className="space-y-1">
              {group.terminals.map((terminal) => (
                <li
                  key={terminal.id}
                  data-background-terminal={terminal.id}
                  className="flex items-center gap-2 text-ui"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <TerminalName terminal={terminal} />
                  </span>
                  {group.available && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        onOpenChange(false);
                        actions?.reopen(terminal);
                      }}
                    >
                      Reopen
                    </Button>
                  )}
                  <Button type="button" variant="ghost" onClick={() => actions?.stop(terminal)}>
                    Stop
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
