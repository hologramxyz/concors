import { useContext, useEffect, useState, type FormEvent } from "react";
import {
  TriggerDefinitionSchema,
  type AgentTrigger,
  type ProviderStatus,
  type TriggerDefinition,
  type WorkspaceSnapshot,
} from "@concors/protocol";
import { useAgents } from "@/agents/context";
import { CompactLayoutContext } from "@/components/compact-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScheduleSelect } from "@/schedules/schedule-select";
import { useTriggers } from "./use-triggers";

export function TriggerForm({
  workspace,
  trigger,
  onClose,
  onSave,
}: {
  workspace: WorkspaceSnapshot;
  trigger?: AgentTrigger;
  onClose: () => void;
  onSave: (definition: TriggerDefinition) => Promise<void>;
}) {
  const { connection } = useTriggers();
  const compact = useContext(CompactLayoutContext);
  const agents = useAgents();
  const [name, setName] = useState(trigger?.name ?? "");
  const [prompt, setPrompt] = useState(trigger?.prompt ?? "");
  const [projectId, setProjectId] = useState(trigger?.projectId ?? workspace.projects[0]?.id ?? "");
  const [target, setTarget] = useState(
    trigger?.target.kind === "supervisor"
      ? "supervisor"
      : trigger?.target.kind === "session"
        ? trigger.target.sessionId
        : "agent",
  );
  const [provider, setProvider] = useState(
    trigger?.target.kind === "agent" ? trigger.target.provider : "",
  );
  const [model, setModel] = useState(
    trigger?.target.kind === "agent" ? (trigger.target.model ?? "") : "",
  );
  const [mode, setMode] = useState<"same" | "new">(trigger?.mode ?? "same");
  const [enabled, setEnabled] = useState(trigger?.enabled ?? true);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    if (!connection) return;
    void connection
      .requestProvider({ kind: "list" }, crypto.randomUUID())
      .then((r) => {
        if (!current) return;
        if (r.outcome.status === "error") throw new Error(r.outcome.message);
        const installed = r.outcome.providers.filter((p) => p.enabled && p.installed);
        setProviders(installed);
        setProvider((value) => value || installed[0]?.id || "");
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : "Could not load providers");
      });
    return () => {
      current = false;
    };
  }, [connection]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const parsed = TriggerDefinitionSchema.safeParse({
      name,
      prompt,
      projectId: target === "supervisor" ? null : projectId,
      target:
        target === "agent"
          ? { kind: "agent", provider, model: model.trim() || null }
          : target === "supervisor"
            ? { kind: "supervisor" }
            : { kind: "session", sessionId: target },
      mode: target === "supervisor" ? "same" : mode,
      enabled,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the webhook fields");
      return;
    }
    setPending(true);
    try {
      await onSave(parsed.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save webhook");
    } finally {
      setPending(false);
    }
  };
  const title = trigger ? "Edit webhook" : "New webhook";
  const fields = (
    <fieldset disabled={pending} className="space-y-4 text-ui">
      <label className="block space-y-1.5">
        <span>Name</span>
        <Input
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="CI build notifications"
        />
      </label>
      <ScheduleSelect
        label="Target chat"
        value={target}
        placeholder="Choose a chat"
        options={[
          { value: "agent", label: "Start an agent chat" },
          { value: "supervisor", label: "Supervisor" },
          ...agents
            .filter((a) => !a.supervisor && a.projectId === projectId)
            .map((a) => ({ value: a.id, label: a.name })),
        ]}
        onChange={setTarget}
      />
      {target !== "supervisor" && (
        <ScheduleSelect
          label="Workspace"
          value={projectId}
          placeholder="Choose a workspace folder"
          options={workspace.projects
            .filter((p) => p.directory)
            .map((p) => ({ value: p.id, label: p.name }))}
          onChange={(id) => {
            setProjectId(id);
            if (target !== "agent") setTarget("agent");
          }}
        />
      )}
      {target === "agent" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <ScheduleSelect
            label="Provider"
            value={provider}
            placeholder="Choose a provider"
            options={providers.map((p) => ({ value: p.id, label: p.label }))}
            onChange={setProvider}
          />
          <label className="block space-y-1.5">
            <span>Model</span>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Provider default"
            />
          </label>
        </div>
      )}
      <ScheduleSelect
        label="Delivery mode"
        value={target === "supervisor" ? "same" : mode}
        disabled={target === "supervisor"}
        placeholder="Choose a mode"
        options={[
          { value: "same", label: "Same chat (keep context)" },
          { value: "new", label: "New chat each time" },
        ]}
        onChange={setMode}
      />
      <label className="block space-y-1.5">
        <span>Prompt (optional)</span>
        <Textarea
          value={prompt}
          maxLength={16000}
          rows={4}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Review the event and summarize what needs attention."
        />
        <span className="text-xs text-muted-foreground">
          Your instructions go here. Event bodies are framed as untrusted data. Normal chat
          permissions and human approvals still apply.
        </span>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enabled
      </label>
    </fieldset>
  );
  const content = (
    <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-col gap-5">
      {compact ? (
        <h2 className="text-lg font-semibold">{title}</h2>
      ) : (
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
      )}
      <div className="min-h-0 overflow-y-auto p-1">{fields}</div>
      {error && (
        <p role="alert" className="text-ui text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : trigger ? "Save webhook" : "Create webhook"}
        </Button>
      </DialogFooter>
    </form>
  );
  if (compact)
    return <div className="mobile-form-page mx-auto w-full max-w-xl px-4 py-6">{content}</div>;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined} className="overflow-hidden">
        {content}
      </DialogContent>
    </Dialog>
  );
}
