import { AgentDraftScopeContext, useAgentDraft, type InputDraft as Draft } from "./draft";
import { isProviderModelsQueryLoading } from "./paseo/model-loading";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Brain,
  SlidersHorizontal,
  ListTodo,
  Zap,
  LoaderCircle,
  Mic,
  Plus,
  Shield,
  ShieldCheck,
  ShieldOff,
  Square,
  X,
} from "lucide-react";
import type { AgentInfo, AgentSettings, AgentAttachment } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { submitAgentInput } from "./paseo/submit";
import { ControlPicker } from "./control-picker";
import { Popover } from "radix-ui";
import { ContextMeter } from "./context-meter";
import { CodexIcon } from "./paseo/codex-icon";
import { useDictation } from "./dictation";
import { CompactLayoutContext } from "@/components/compact-layout";
import { ComposerSurfaceContext, useComposerExpansion } from "./composer-expansion";
import { useComposerMotion } from "./composer-motion";
const defaults: AgentSettings = { model: null, effort: null, mode: "default" };
export function AgentComposer({
  agent,
  connected,
  onInterrupt,
}: {
  agent: AgentInfo;
  connected: boolean;
  onInterrupt: () => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const compact = useContext(CompactLayoutContext);
  const { owner, expanded, expand } = useComposerExpansion(compact);
  const [keyboardHelp, setKeyboardHelp] = useState(false);
  const {
    draft,
    setDraft,
    attachments,
    setAttachments,
    queue,
    setQueue,
    uncertain,
    setUncertain,
    busy,
    setBusy,
    attempt: attemptRef,
    sending: sendingRef,
  } = useAgentDraft(useContext(AgentDraftScopeContext) ?? connection, agent.id);
  const [uploading, setUploading] = useState(false),
    [configuring, setConfiguring] = useState(false),
    [loadingModels, setLoadingModels] = useState(false),
    [error, setError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null),
    picker = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const advanced =
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes("agent-composer");
  const modelsLoading = isProviderModelsQueryLoading({
    isLoading: agent.status === "starting",
    isFetching: loadingModels,
  });
  const active = ["starting", "working", "needs_input"].includes(agent.status);
  const showStop = active && (!compact || (!draft.trim() && !attachments.length));
  const settings = agent.settings ?? defaults,
    models = agent.models ?? [];
  const dictation = useDictation((text) =>
    setDraft((value) => (value + (value ? " " : "") + text).slice(0, 16000)),
  );
  useLayoutEffect(() => {
    const el = textarea.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 192) + "px";
    }
  }, [draft, expanded]);
  useComposerMotion(form, compact, expanded);
  const configure = async (next: AgentSettings) => {
    if (!connection || !advanced) return;
    setConfiguring(true);
    setError(null);
    try {
      const result = await connection.requestAgent(
        {
          kind: "configure",
          sessionId: agent.id,
          settings: next,
          expectedRevision: agent.revision,
        },
        crypto.randomUUID(),
      );
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update agent settings");
    } finally {
      setConfiguring(false);
    }
  };
  const refresh = async () => {
    if (!connection || !advanced) return;
    setLoadingModels(true);
    try {
      const result = await connection.requestAgent(
        { kind: "refresh-models", sessionId: agent.id },
        crypto.randomUUID(),
      );
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load models");
    } finally {
      setLoadingModels(false);
    }
  };
  const send = async (input: Draft) => {
    if (!connection) throw new Error("Machine is disconnected");
    const next = attemptRef.current ?? {
      id: crypto.randomUUID(),
      draft: input,
      operation: {
        kind: "send" as const,
        sessionId: agent.id,
        text: input.message,
        attachments: input.attachments,
      },
    };
    attemptRef.current = next;
    try {
      const result = await connection.requestAgent(next.operation, next.id);
      if (result.outcome.status === "error") {
        attemptRef.current = null;
        setUncertain(false);
        throw new Error(result.outcome.message);
      }
      setQueue((q) => q.filter((entry) => entry !== next.draft));
      attemptRef.current = null;
      setUncertain(false);
    } catch (e) {
      if (attemptRef.current) setUncertain(true);
      throw e;
    }
  };
  const submit = async (input: Draft = { message: draft, attachments }, queued = false) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      return await submitAgentInput({
        message: input.message,
        attachments: input.attachments,
        canSubmit: connected && !busy && !uploading && !configuring && !!agent.threadId,
        isAgentRunning: active,
        forceSend: attemptRef.current !== null,
        submitBehavior: "preserve-and-lock",
        queueMessage: (value) => {
          setQueue((q) => [...q, value]);
          setDraft("");
          setAttachments([]);
        },
        submitMessage: () => send(input),
        clearDraft: () => {
          if (!queued) {
            setDraft("");
            setAttachments([]);
          }
        },
        setUserInput: setDraft,
        setAttachments,
        setSendError: setError,
        setIsProcessing: setBusy,
      });
    } finally {
      sendingRef.current = false;
    }
  };
  const queueHead = queue[0];
  useEffect(() => {
    if (active || !queueHead || !connected || busy || uncertain || sendingRef.current) return;
    void submit(queueHead, true);
    // Queue delivery is triggered by authoritative agent state; failures require explicit retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, queueHead, connected]);
  const addFiles = async (files: FileList | File[]) => {
    if (uploading || !advanced) return;
    setUploading(true);
    setError(null);
    try {
      if (attachments.length + files.length > 3)
        throw new Error("Attach up to three files per message.");
      const incoming: AgentAttachment[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 1024 * 1024) throw new Error(`${file.name} is larger than 1 MB.`);
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
          reader.onerror = () => reject(new Error("Could not read attachment"));
          reader.readAsDataURL(file);
        });
        incoming.push({ name: file.name, mime: file.type || "application/octet-stream", data });
      }
      setAttachments((value) => [...value, ...incoming].slice(0, 3));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not attach files");
    } finally {
      setUploading(false);
    }
  };
  const effortModel = models.find((m) => m.id === (settings.model ?? agent.model));
  const extraControls = (
    <>
      {agent.supportsPlan && (
        <button
          type="button"
          aria-label="Plan mode"
          aria-pressed={!!settings.planMode}
          title="Plan mode: explore and plan with read-only access"
          className={`agent-control ${settings.planMode ? "bg-primary/10 text-primary!" : ""}`}
          disabled={!connected || busy || configuring}
          onClick={() => void configure({ ...settings, planMode: !settings.planMode })}
        >
          <ListTodo className="size-4" />
        </button>
      )}
      {!!effortModel?.serviceTiers?.length && (
        <ControlPicker
          label="Speed"
          value={settings.serviceTier ?? ""}
          icon={<Zap className={`size-4 ${settings.serviceTier ? "text-amber-500" : ""}`} />}
          disabled={!connected || busy || configuring}
          options={[
            { id: "", label: "Default speed", icon: <Zap className="size-4" /> },
            ...effortModel.serviceTiers.map((tier) => ({
              ...tier,
              icon: <Zap className="size-4" />,
            })),
          ]}
          onSelect={(serviceTier) =>
            void configure({ ...settings, serviceTier: serviceTier || null })
          }
        />
      )}
    </>
  );
  const utilityControls = (
    <>
      <ContextMeter context={agent.context} />
      <button
        type="button"
        aria-label={dictation.listening ? "Stop dictation" : "Start dictation"}
        title={
          compact
            ? "Use dictation on your phone's keyboard."
            : dictation.supported
              ? "Dictation uses your browser's speech service. Review the transcript before sending."
              : "Dictation is not supported by this browser."
        }
        disabled={(!compact && !dictation.supported) || !connected || busy || uncertain}
        onClick={() => {
          if (compact) {
            textarea.current?.focus();
            setKeyboardHelp((value) => !value);
          } else dictation.toggle();
        }}
        className={`agent-control ${dictation.listening ? "bg-red-500/10 text-red-500" : "text-muted-foreground hover:bg-muted"}`}
      >
        <Mic className="size-4" />
      </button>
    </>
  );
  return (
    <ComposerSurfaceContext value={owner}>
      <div className="space-y-2">
        {!!queue.length && (
          <div
            data-composer-queue
            className={compact ? "max-h-20 space-y-2 overflow-y-auto" : "space-y-2"}
          >
            {queue.map((entry, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs"
              >
                <span className="text-muted-foreground">Queued</span>
                <span className="min-w-0 flex-1 truncate">
                  {entry.message || entry.attachments.map((a) => a.name).join(", ")}
                </span>
                {!active && !busy && !uncertain && (
                  <button
                    type="button"
                    className="text-primary"
                    onClick={() => void submit(entry, true)}
                  >
                    Send now
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Remove queued message"
                  disabled={busy || uncertain}
                  onClick={() => setQueue((q) => q.filter((_, index) => index !== i))}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {(error || dictation.error) && (
          <p role="alert" className="text-xs text-destructive">
            {error ?? dictation.error}
          </p>
        )}
        {uncertain && (
          <div className="flex items-center gap-2 text-xs">
            <span>Delivery could not be confirmed.</span>
            <button
              className="text-primary"
              onClick={() =>
                void submit(
                  attemptRef.current?.draft,
                  !!attemptRef.current && queue.includes(attemptRef.current.draft),
                )
              }
            >
              Retry same message
            </button>
          </div>
        )}
        <form
          ref={form}
          data-composer-surface={owner}
          data-expanded={compact ? expanded : undefined}
          onSubmit={(e) => {
            e.preventDefault();
            if (!uncertain) void submit();
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy && !uncertain) void addFiles(e.dataTransfer.files);
          }}
          className={`rounded-2xl border bg-background p-2 shadow-sm focus-within:border-primary/40 ${compact ? "mobile-composer" : ""}`}
        >
          {attachments.length > 0 && (
            <div
              data-composer-attachments
              className={`flex flex-wrap gap-2 px-2 py-1 ${compact ? "max-h-16 overflow-y-auto" : ""}`}
            >
              {attachments.map((file, i) => (
                <div
                  key={i}
                  className="flex max-w-52 items-center gap-2 rounded-lg border bg-muted/40 px-2 py-1 text-xs"
                >
                  {file.mime.startsWith("image/") && (
                    <img
                      className="size-8 rounded object-cover"
                      alt=""
                      src={`data:${file.mime};base64,${file.data}`}
                    />
                  )}
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    disabled={busy || uncertain}
                    onClick={() => setAttachments((a) => a.filter((_, index) => index !== i))}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textarea}
            data-agent-composer
            aria-label="Message Codex"
            placeholder={
              compact && !expanded
                ? "Message your agent"
                : active
                  ? "Add a follow-up to the queue…"
                  : "Ask your agent to build something…"
            }
            value={draft}
            rows={compact && !expanded ? 1 : 2}
            onFocus={compact ? expand : undefined}
            onClick={compact ? expand : undefined}
            enterKeyHint={compact ? "enter" : "send"}
            maxLength={16000}
            disabled={!connected || busy || uncertain || !agent.threadId}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                void addFiles(e.clipboardData.files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Tab" && e.shiftKey && !configuring && advanced) {
                e.preventDefault();
                const modes: AgentSettings["mode"][] = ["default", "auto-review", "full-access"];
                void configure({
                  ...settings,
                  mode: modes[(modes.indexOf(settings.mode) + 1) % modes.length] ?? "default",
                });
              }
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                (!compact || e.metaKey || e.ctrlKey)
              ) {
                e.preventDefault();
                if (!uncertain) void submit();
              }
            }}
            className="max-h-48 min-h-16 w-full resize-none bg-transparent px-3 py-3 text-[16px] leading-relaxed outline-none disabled:opacity-50"
          />
          {dictation.listening && (
            <p role="status" className="px-3 pb-2 text-xs text-primary">
              {dictation.interim || "Listening… Click the microphone to finish."}
            </p>
          )}
          <div
            className={`flex items-center gap-1 px-1 ${compact ? "mobile-composer-toolbar" : "flex-wrap"}`}
          >
            <input
              ref={picker}
              type="file"
              multiple
              className="hidden"
              aria-label="Upload files"
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              aria-label="Attach files"
              title="Attach files or paste an image (up to three, 1 MB each)"
              className="agent-control mobile-composer-attach"
              disabled={!advanced || !connected || busy || uploading || uncertain}
              onClick={() => picker.current?.click()}
            >
              <Plus className="size-4" />
            </button>
            <div
              className={compact ? "mobile-composer-settings" : "contents"}
              hidden={compact && !expanded}
            >
              <ControlPicker
                label="Agent and model"
                showValue={!compact}
                selectedLabel={
                  models.find((model) => model.id === (settings.model ?? agent.model))?.label ??
                  settings.model ??
                  agent.model ??
                  "Machine default"
                }
                value={settings.model ?? ""}
                icon={
                  modelsLoading ? <LoaderCircle className="size-4 animate-spin" /> : <CodexIcon />
                }
                disabled={!advanced || !connected || busy || configuring || modelsLoading}
                options={[
                  {
                    id: "",
                    label: "Machine default",
                    description: agent.model ?? "Use this machine’s configured model",
                    icon: <CodexIcon />,
                  },
                  ...models.map((model) => ({
                    id: model.id,
                    label: model.label,
                    icon: <CodexIcon />,
                  })),
                ]}
                onSelect={(model) =>
                  void configure({
                    ...settings,
                    model: model || null,
                    effort: null,
                    serviceTier: null,
                  })
                }
                footer={
                  <button
                    type="button"
                    aria-label="Refresh agent models"
                    disabled={modelsLoading}
                    onClick={() => void refresh()}
                    className="w-full border-t px-2 py-2 text-left text-xs text-muted-foreground hover:bg-muted"
                  >
                    Refresh models
                  </button>
                }
              />
              <ControlPicker
                label="Thinking effort"
                showValue={!compact}
                value={settings.effort ?? ""}
                icon={<Brain className="size-4" />}
                disabled={!advanced || !connected || busy || configuring}
                options={[
                  {
                    id: "",
                    label: `Default (${effortModel?.defaultEffort ?? "automatic"})`,
                    icon: <Brain className="size-4" />,
                  },
                  ...(effortModel?.efforts ?? []).map((effort) => ({
                    id: effort,
                    label: effort.charAt(0).toUpperCase() + effort.slice(1),
                    icon: <Brain className="size-4" />,
                  })),
                ]}
                onSelect={(effort) => void configure({ ...settings, effort: effort || null })}
              />
              <ControlPicker
                label="Permission mode"
                showValue={!compact}
                value={settings.mode}
                icon={
                  settings.mode === "auto-review" ? (
                    <ShieldCheck className="size-4" />
                  ) : settings.mode === "full-access" ? (
                    <ShieldOff className="size-4 text-amber-500" />
                  ) : (
                    <Shield className="size-4" />
                  )
                }
                disabled={!advanced || !connected || busy || configuring}
                options={[
                  {
                    id: "default",
                    label: "Default permissions",
                    description: "Workspace access; asks when approval is needed.",
                    icon: <Shield className="size-4" />,
                  },
                  {
                    id: "auto-review",
                    label: "Auto-review",
                    description: "Same sandbox; eligible requests go to the reviewer agent.",
                    icon: <ShieldCheck className="size-4" />,
                  },
                  {
                    id: "full-access",
                    label: "Full access",
                    description: "File and network access without approval prompts.",
                    icon: <ShieldOff className="size-4 text-amber-500" />,
                  },
                ]}
                onSelect={(mode) =>
                  void configure({ ...settings, mode: mode as AgentSettings["mode"] })
                }
              />
              {compact ? (
                <Popover.Root>
                  <Popover.Trigger
                    type="button"
                    className="agent-control"
                    aria-label="More composer options"
                    title="Plan mode and speed"
                  >
                    <SlidersHorizontal className="size-4" />
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Content
                      data-composer-surface={owner}
                      side="top"
                      align="start"
                      sideOffset={8}
                      collisionPadding={12}
                      className="mobile-composer-options"
                    >
                      <p className="mb-2 px-2 text-sm font-medium">Conversation options</p>
                      <div className="mobile-composer-options-grid">{extraControls}</div>
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              ) : (
                extraControls
              )}
            </div>
            {compact && (
              <div className="mobile-composer-utilities" hidden={!expanded}>
                {utilityControls}
              </div>
            )}
            <div className="mobile-composer-primary ml-auto flex items-center gap-1">
              {!compact && utilityControls}
              {showStop && (
                <button
                  type="button"
                  aria-label="Interrupt agent"
                  disabled={!connected || !agent.turnId || agent.turnId.startsWith("pending:")}
                  onClick={onInterrupt}
                  className="rounded-lg border p-2"
                >
                  <Square className="size-4" />
                </button>
              )}
              {(!compact || !showStop) && (
                <button
                  aria-label={active ? "Queue message" : "Send message"}
                  disabled={
                    !connected ||
                    uploading ||
                    busy ||
                    configuring ||
                    uncertain ||
                    (!draft.trim() && !attachments.length) ||
                    !agent.threadId
                  }
                  className="rounded-lg bg-primary p-2 text-primary-foreground disabled:opacity-30"
                >
                  {busy ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ArrowUp className="size-4" />
                  )}
                </button>
              )}
            </div>
          </div>
        </form>
        {compact && expanded && keyboardHelp && (
          <p role="status" className="px-2 text-xs text-muted-foreground">
            Use the microphone on your phone’s keyboard to dictate. Review your message before
            sending.
          </p>
        )}
        {(uploading || (compact && (!connected || configuring))) && (
          <p role="status" className="px-2 text-xs text-muted-foreground">
            {uploading
              ? "Reading attachments…"
              : !connected
                ? "Reconnecting…"
                : "Updating agent settings…"}
          </p>
        )}
      </div>
    </ComposerSurfaceContext>
  );
}
