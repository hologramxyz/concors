import { useContext, useEffect, useMemo, useState } from "react";
import {
  SUPERVISOR_CAPABILITY,
  type AgentInfo,
  type AgentPending,
  type WorkspaceSnapshot,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { CompactLayoutContext } from "@/components/compact-layout";
import { ChatPane } from "@/agents/chat";
import { AgentStartedContext } from "@/agents/context";
import { Button } from "@/components/ui/button";
import { WorkspaceFileLinks } from "@/files/provider";
import { SessionLinkContext } from "./session-link";
import { AgentDraftScopeContext, useAgentDraft } from "@/agents/draft";
import { MAX_SUPERVISOR_REFERENCES, referenceLabel } from "./reference-text";
import { useAgents } from "@/agents/context";
import { SupervisorOverview } from "./overview";
import {
  SupervisorReferences,
  supervisorAgentName,
  supervisorReferences,
} from "./reference-context";
import { supervisorPane } from "./pane";
import { approvalSummary } from "@/agents/approval-summary";

/** The ordinary unified chat, including its provider picker and native mobile composer. */
export function SupervisorPage({
  workspace,
  connected,
  onOpenAgent,
  onOpenProject,
  overviewOpen,
  onCloseOverview,
}: {
  workspace: WorkspaceSnapshot | null;
  connected: boolean;
  onOpenAgent: (id: string) => void;
  overviewOpen: boolean;
  onCloseOverview: () => void;
  /** Brings up a workspace, where a file the Supervisor links to opens. */
  onOpenProject: (projectId: string) => void;
}) {
  const projects = [...(workspace?.projects ?? []), ...(workspace?.closedProjects ?? [])];
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const agents = useAgents();
  const projectList = workspace?.projects,
    closedList = workspace?.closedProjects;
  // Kept stable between renders, so the composer's mention menu does not re-render with them.
  const references = useMemo(
    () => supervisorReferences({ projects: projectList ?? [], closedProjects: closedList }, agents),
    [projectList, closedList, agents],
  );
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
  const supervisorId = pane?.sessionId ?? null;
  const agent = agents.find((value) => value.id === supervisorId);
  const draft = useAgentDraft(
    useContext(AgentDraftScopeContext) ?? connection,
    supervisorId ?? "",
    workspace?.machineId,
  );
  const canAsk = !!agent?.threadId && connected && !draft.busy && !draft.uncertain;
  // Asking about an approval drafts a question that mentions the agent, for the person to send.
  // The answer is still given in the agent's own chat.
  const ask = (worker: AgentInfo, pending: AgentPending) => {
    const label = referenceLabel(supervisorAgentName(worker));
    const reference = {
      id: worker.id,
      kind: "Agent" as const,
      label,
      workspace: names.get(worker.projectId) ?? "",
    };
    draft.setReferences((refs) => [
      ...refs
        .filter((ref) => ref.kind !== reference.kind || ref.id !== reference.id)
        .slice(0, MAX_SUPERVISOR_REFERENCES - 1),
      reference,
    ]);
    const action = approvalSummary(pending).split("\n")[0]?.slice(0, 120);
    const question = action
      ? `Should I approve @${label}’s request “${action}”?`
      : `What should I do about @${label}’s pending request?`;
    draft.setDraft((text) => (text.trim() ? `${text.trimEnd()}\n\n${question}` : question));
  };
  // The phone app's native field has no textarea here; it is focused natively.
  const focusComposer = () =>
    document
      .querySelector<HTMLTextAreaElement>(
        `[data-pane-id="${pane?.id}"] textarea[data-agent-composer]`,
      )
      ?.focus();
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
              {overviewOpen && (
                <SupervisorOverview
                  workspace={workspace}
                  supervisorId={supervisorId}
                  canAsk={canAsk}
                  onAsk={ask}
                  focusComposer={focusComposer}
                  compact={compact}
                  onClose={onCloseOverview}
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
