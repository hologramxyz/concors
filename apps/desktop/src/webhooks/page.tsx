import { useContext, useState } from "react";
import { ArrowUpRight, KeyRound, Pencil, Plus, Trash2, Webhook } from "lucide-react";
import {
  WEBHOOK_TRIGGERS_CAPABILITY,
  type AgentTrigger,
  type TriggerDefinition,
  type TriggerRequest,
  type WorkspaceSnapshot,
} from "@concors/protocol";
import { useAgents } from "@/agents/context";
import { CompactLayoutContext } from "@/components/compact-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { dateLabel } from "@/schedules/schedule-labels";
import { useTriggers } from "./use-triggers";
import { createdTriggerId, triggerTargetLabel } from "./helpers";
import { TriggerForm } from "./trigger-form";
import { SecretDialog } from "./secret-dialog";

export function WebhooksPage({
  workspace,
  connected,
  hostname,
  onOpenAgent,
}: {
  workspace: WorkspaceSnapshot | null;
  connected: boolean;
  hostname: string | null;
  onOpenAgent: (id: string) => void;
}) {
  const { connection, triggers } = useTriggers();
  const agents = useAgents();
  const compact = useContext(CompactLayoutContext);
  const [editing, setEditing] = useState<AgentTrigger | "new" | null>(null);
  const [confirming, setConfirming] = useState<{
    trigger: AgentTrigger;
    kind: "delete" | "rotate";
  } | null>(null);
  const [credentials, setCredentials] = useState<{ id: string; secret: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported =
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes(WEBHOOK_TRIGGERS_CAPABILITY);
  const available = !!(supported && connected && workspace && triggers);
  const act = async (operation: TriggerRequest["operation"]) => {
    if (!connection || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await connection.requestTrigger(operation, crypto.randomUUID());
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      if (result.outcome.secret) {
        const id =
          "id" in operation
            ? operation.id
            : createdTriggerId(triggers ?? [], result.outcome.triggers, result.outcome.secret);
        if (!id)
          throw new Error("Could not identify the new webhook. Rotate its secret to try again.");
        setCredentials({ id, secret: result.outcome.secret });
      }
      setEditing(null);
      setConfirming(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update webhook");
      throw cause;
    } finally {
      setPending(false);
    }
  };
  const run = (operation: TriggerRequest["operation"]) => {
    void act(operation).catch(() => undefined);
  };
  const save = (definition: TriggerDefinition) =>
    act(
      editing && editing !== "new"
        ? {
            kind: "update",
            id: editing.id,
            expectedRevision: editing.revision,
            trigger: definition,
          }
        : { kind: "create", trigger: definition },
    );
  const form =
    editing && workspace && available ? (
      <TriggerForm
        key={editing === "new" ? "new" : editing.id}
        workspace={workspace}
        {...(editing === "new" ? {} : { trigger: editing })}
        onClose={() => setEditing(null)}
        onSave={save}
      />
    ) : null;
  if (compact && form) return form;
  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 data-page-title className="text-xl font-semibold">
            Webhooks
          </h2>
          <p className="mt-1 text-ui text-muted-foreground">
            Turn external events into work in your chats.
          </p>
        </div>
        <Button
          disabled={!available || pending || (triggers?.length ?? 0) >= 64}
          onClick={() => {
            setError(null);
            setEditing("new");
          }}
        >
          <Plus />
          New webhook
        </Button>
      </div>
      {!hostname && (
        <p className="mt-5 rounded-lg border bg-muted/40 p-4 text-ui text-muted-foreground">
          Webhooks need a cloud machine to receive external events. You can still create and manage
          triggers on this machine.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-ui text-destructive">
          {error}
        </p>
      )}
      {!available ? (
        <p className="mt-8 text-ui text-muted-foreground">
          {!connected
            ? "Connect to a machine to manage its webhooks."
            : !supported
              ? "Update the daemon on this machine to use webhooks."
              : "Loading webhooks…"}
        </p>
      ) : !triggers?.length ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16">
          <Webhook className="size-8 text-muted-foreground" />
          <h3 className="text-lg font-medium">No webhooks yet</h3>
          <p className="max-w-md text-center text-ui text-muted-foreground">
            Connect CI, alerts, or bots to a chat. Busy chats queue events, so no work interrupts
            your current turn.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {triggers.map((trigger) => (
            <article
              key={trigger.id}
              className="overflow-hidden rounded-lg border bg-background text-ui shadow-xs"
            >
              <div className="space-y-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium break-words">{trigger.name}</h3>
                      <Badge variant="secondary">{trigger.enabled ? "Enabled" : "Disabled"}</Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {triggerTargetLabel(trigger, agents)} ·{" "}
                      {trigger.mode === "same" ? "Same chat" : "New chat each time"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending || !available}
                      aria-label={`${trigger.enabled ? "Disable" : "Enable"} ${trigger.name}`}
                      onClick={() =>
                        run({
                          kind: "update",
                          id: trigger.id,
                          expectedRevision: trigger.revision,
                          trigger: { ...trigger, enabled: !trigger.enabled },
                        })
                      }
                    >
                      {trigger.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pending || !available}
                      aria-label={`Edit ${trigger.name}`}
                      onClick={() => setEditing(trigger)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pending || !available}
                      aria-label={`Rotate secret for ${trigger.name}`}
                      onClick={() => setConfirming({ trigger, kind: "rotate" })}
                    >
                      <KeyRound />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pending || !available}
                      aria-label={`Delete ${trigger.name}`}
                      onClick={() => setConfirming({ trigger, kind: "delete" })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                {trigger.prompt && (
                  <p className="line-clamp-2 break-words whitespace-pre-wrap text-foreground/80">
                    {trigger.prompt}
                  </p>
                )}
                <p className="font-mono text-xs text-muted-foreground">
                  Secret ending in ••••{trigger.secretHint}
                </p>
              </div>
              <details className="border-t">
                <summary className="cursor-pointer px-4 py-3 text-muted-foreground hover:bg-muted/50 sm:px-5">
                  Recent events · {trigger.events.length}
                </summary>
                {!trigger.events.length ? (
                  <p className="border-t px-5 py-4 text-muted-foreground">
                    No events received yet.
                  </p>
                ) : (
                  <ol className="space-y-2 border-t p-4">
                    {trigger.events.map((event) => (
                      <li
                        key={event.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <time dateTime={event.receivedAt} className="text-muted-foreground">
                              {dateLabel(event.receivedAt)}
                            </time>
                            <span className="break-words">{event.source}</span>
                            <Badge
                              variant={event.status === "failed" ? "destructive" : "secondary"}
                            >
                              {event.status}
                            </Badge>
                          </div>
                          {event.message && (
                            <p className="mt-1 text-xs break-words text-muted-foreground">
                              {event.message}
                            </p>
                          )}
                        </div>
                        {event.sessionId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (event.sessionId) onOpenAgent(event.sessionId);
                            }}
                          >
                            Open chat
                            <ArrowUpRight />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </details>
            </article>
          ))}
        </div>
      )}
      {form}
      {confirming && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !pending) setConfirming(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {confirming.kind === "delete" ? "Delete webhook" : "Rotate secret"} “
                {confirming.trigger.name}”?
              </DialogTitle>
              <DialogDescription>
                {confirming.kind === "delete"
                  ? "This cannot be undone. Queued events must be removed or delivered first."
                  : "The old secret stops working immediately. Update your external tools with the new secret."}
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={pending} onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button
                variant={confirming.kind === "delete" ? "destructive" : "default"}
                disabled={pending}
                onClick={() =>
                  run({
                    kind: confirming.kind,
                    id: confirming.trigger.id,
                    expectedRevision: confirming.trigger.revision,
                  })
                }
              >
                {confirming.kind === "delete" ? "Delete webhook" : "Rotate secret"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {credentials && (
        <SecretDialog {...credentials} hostname={hostname} onClose={() => setCredentials(null)} />
      )}
    </div>
  );
}
