import { useContext, useEffect, useState } from "react";
import { SUPERVISOR_CAPABILITY, type WorkspaceSnapshot } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { CompactLayoutContext } from "@/components/compact-layout";
import { ChatPane } from "@/agents/chat";
import { AgentStartedContext } from "@/agents/context";
import { Button } from "@/components/ui/button";
import { WorkspaceFileLinks } from "@/files/provider";
import { SessionLinkContext } from "./session-link";
import { useAgents } from "@/agents/context";
import { SupervisorActivity } from "./activity";
import {
  SupervisorReferences,
  supervisorAgentName,
  type SupervisorReference,
} from "./reference-context";
import { supervisorPane } from "./pane";

/** The ordinary unified chat, including its provider picker and native mobile composer. */
export function SupervisorPage({
  workspace,
  connected,
  onOpenAgent,
  onOpenProject,
  activityOpen,
  onCloseActivity,
}: {
  workspace: WorkspaceSnapshot | null;
  connected: boolean;
  onOpenAgent: (id: string) => void;
  activityOpen: boolean;
  onCloseActivity: () => void;
  /** Brings up a workspace, where a file the Supervisor links to opens. */
  onOpenProject: (projectId: string) => void;
}) {
  const projects = workspace?.projects ?? [];
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const references: SupervisorReference[] = [
    ...projects.map((project) => ({
      id: project.id,
      kind: "Workspace" as const,
      label: project.name,
    })),
    ...useAgents().flatMap((agent) => {
      const label = names.get(agent.projectId);
      return !agent.supervisor && label
        ? [
            {
              id: agent.id,
              kind: "Agent" as const,
              label: supervisorAgentName(agent),
              workspace: label,
            },
          ]
        : [];
    }),
  ];
  const connection = useContext(TerminalConnectionContext);
  const compact = useContext(CompactLayoutContext);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const supported =
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes(SUPERVISOR_CAPABILITY);
  useEffect(() => {
    if (!connection || !connected || !supported) return;
    let current = true;
    void connection
      .requestSupervisor({ kind: "open" }, crypto.randomUUID())
      .then((result) => {
        if (!current) return;
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : "Could not open Supervisor");
      });
    return () => {
      current = false;
    };
  }, [connection, connected, supported, retry]);
  const project = workspace?.supervisor,
    tab = project?.tabs[0],
    pane = supervisorPane(workspace);
  return (
    <AgentStartedContext value={undefined}>
      <SessionLinkContext value={onOpenAgent}>
        <div
          className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          data-testid="supervisor-page"
        >
          {error ? (
            <div role="alert" className="p-6 text-sm text-destructive">
              {error}
              <Button variant="outline" className="ml-3" onClick={() => setRetry((n) => n + 1)}>
                Retry
              </Button>
            </div>
          ) : !supported && connected ? (
            <p className="p-6 text-sm text-muted-foreground">
              Update the daemon on this machine to use Supervisor.
            </p>
          ) : project && tab && pane ? (
            // A chat's keys (Escape stops its turn, the dictation shortcut) act only where focus
            // is inside its pane, which the workspace marks with this attribute; so does this page.
            <div className="flex min-h-0 min-w-0 flex-1">
              <div data-pane-id={pane.id} className="flex min-h-0 min-w-0 flex-1 flex-col">
                <SupervisorReferences value={references}>
                  <WorkspaceFileLinks
                    projects={workspace?.projects ?? []}
                    onShowProject={onOpenProject}
                  >
                    <ChatPane
                      key={project.id}
                      project={project}
                      tab={tab}
                      node={pane}
                      canEdit={connected}
                      // Keep the normal desktop new-chat layout and the phone's bottom composer.
                      start={compact ? undefined : <></>}
                    />
                  </WorkspaceFileLinks>
                </SupervisorReferences>
              </div>
              {activityOpen && (
                <SupervisorActivity
                  workspace={workspace}
                  compact={compact}
                  onClose={onCloseActivity}
                  onOpenAgent={onOpenAgent}
                />
              )}
            </div>
          ) : (
            <p role="status" className="p-6 text-sm text-muted-foreground">
              {connected ? "Opening Supervisor…" : "Connect to this machine to use Supervisor."}
            </p>
          )}
        </div>
      </SessionLinkContext>
    </AgentStartedContext>
  );
}
