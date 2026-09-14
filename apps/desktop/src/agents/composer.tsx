import { modelOptions } from "@concors/client-core";
import { AgentDraftScopeContext, useAgentDraft, type InputDraft as Draft } from "./draft";
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
import {
  agentProviderName,
  type AgentInfo,
  type AgentSettings,
  type AgentAttachment,
  type AgentProviderId,
  type AgentOperation,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { submitAgentInput } from "./paseo/submit";
import { ControlPicker } from "./control-picker";
import { Popover } from "radix-ui";
import { ContextMeter } from "./context-meter";
import { AgentModelPicker } from "./model-picker";
import { findAgentModel } from "@concors/protocol";
import { useAgentModelSelection } from "./use-model-selection";
import { useDictation } from "./dictation";
import { appendDictation } from "./dictation-session";
import { DictationRecording } from "./dictation-recording";
import { TabVisibility } from "@/workspace/tab-visibility";
import { CompactLayoutContext } from "@/components/compact-layout";
import { ComposerSurfaceContext, useComposerExpansion } from "./composer-expansion";
import { useComposerMotion } from "./composer-motion";
import { NativeSurfaceContext, useNativeSurface } from "@/components/native-surface";
const defaults: AgentSettings = { model: null, effort: null, mode: "default" };
const nativeProviderIcons: Record<string, "model" | "claude" | "opencode" | "pi"> = {
  codex: "model",
  claude: "claude",
  opencode: "opencode",
  pi: "pi",
} as const;
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
  const visible = useContext(TabVisibility);
  const nativeHost = useContext(NativeSurfaceContext);
  const native = compact && !!nativeHost;
  const { owner, expanded: webExpanded, expand } = useComposerExpansion(compact && !native);
  const [nativeExpanded, setNativeExpanded] = useState(false);
  const [nativeHeight, setNativeHeight] = useState(56);
  const [editAck, setEditAck] = useState(0);
  const nativeEditSequence = useRef(0);
  const nativeField = useRef<HTMLDivElement>(null);
  const expanded = native ? nativeExpanded : webExpanded;
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
  } = useAgentDraft(
    useContext(AgentDraftScopeContext) ?? connection,
    agent.id,
    connection?.workspace?.machineId,
  );
  const [uploading, setUploading] = useState(false),
    [configuring, setConfiguring] = useState(false),
    [error, setError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null),
    picker = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => {
    if (!native) return;
    const footer = form.current?.closest<HTMLElement>("[data-chat-footer]");
    const chat = footer?.closest<HTMLElement>('[aria-label="Agent conversation"]');
    if (!footer || !chat) return;
    const reserve = () =>
      chat.style.setProperty(
        "--native-composer-inset",
        `${footer.getBoundingClientRect().height + 16}px`,
      );
    const observer = new ResizeObserver(reserve);
    observer.observe(footer);
    reserve();
    return () => {
      observer.disconnect();
      chat.style.removeProperty("--native-composer-inset");
    };
  }, [native]);
  const advanced =
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes("agent-composer");
  const durableQueue =
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes("agent-queue");
  const active = ["starting", "working", "needs_input"].includes(agent.status);
  const showStop = active && (!compact || (!draft.trim() && !attachments.length));
  const settings = agent.settings ?? defaults;
  const dictationBase = useRef("");
  const wasDictating = useRef(false);
  const dictation = useDictation(
    {
      onTranscript: (text) => setDraft(appendDictation(dictationBase.current, text)),
      onFinish: (text, action) => {
        const message = appendDictation(dictationBase.current, text);
        setDraft(message);
        if (action === "send" && connected && visible && !uncertain && !document.hidden)
          void submit({ message, attachments });
      },
      onCancel: () => setDraft(dictationBase.current),
    },
    connected && visible,
  );
  useLayoutEffect(() => {
    if (wasDictating.current && !dictation.active && visible && !document.hidden)
      textarea.current?.focus();
    wasDictating.current = dictation.active;
  }, [dictation.active, visible]);
  useLayoutEffect(() => {
    const el = textarea.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 192) + "px";
    }
  }, [draft, expanded, dictation.active]);
  useComposerMotion(form, compact && !native, expanded);
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
  const send = async (input: Draft, steering = false) => {
    if (!connection) throw new Error("Machine is disconnected");
    const next = attemptRef.current ?? {
      id: crypto.randomUUID(),
      draft: input,
      operation: {
        kind: steering
          ? ("steer" as const)
          : active && durableQueue
            ? ("queue-add" as const)
            : ("send" as const),
        turnId: agent.turnId ?? "",
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
  const submit = async (
    input: Draft = { message: draft, attachments },
    queued = false,
    steering = false,
  ) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      return await submitAgentInput({
        message: input.message,
        attachments: input.attachments,
        canSubmit: connected && !busy && !uploading && !configuring && !!agent.threadId,
        isAgentRunning: active && !durableQueue,
        forceSend: attemptRef.current !== null || steering,
        submitBehavior: "preserve-and-lock",
        queueMessage: (value) => {
          setQueue((q) => [...q, value]);
          setDraft("");
          setAttachments([]);
        },
        submitMessage: () => send(input, steering),
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
    if (
      durableQueue ||
      active ||
      !queueHead ||
      !connected ||
      busy ||
      uncertain ||
      sendingRef.current
    )
      return;
    void submit(queueHead, true);
    // Queue delivery is triggered by authoritative agent state; failures require explicit retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, queueHead, connected, durableQueue]);
  const queueAction = async (operation: AgentOperation) => {
    try {
      if (!connection) throw new Error("Machine is disconnected");
      const result = await connection.requestAgent(operation, crypto.randomUUID());
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update the queue");
    }
  };
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
  const nativeModels = useAgentModelSelection(
    agent,
    (model) =>
      void configure({ ...settings, model, effort: null, serviceTier: null, features: {} }),
    native && !!advanced && connected && !busy,
  );
  const [nativeProviderPage, setNativeProviderPage] = useState<AgentProviderId | undefined>(
    agent.provider,
  );
  useEffect(() => {
    if (native && connected) void nativeModels.load();
    // Native action sheets have no open event; load on connection/session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, connected, agent.id]);
  const nativeProvider = nativeModels.providers.find(
    (provider) => provider.id === nativeProviderPage,
  );
  const effortModel = findAgentModel(nativeModels.currentModels, nativeModels.selection.value);
  const controlsDisabled = !advanced || !connected || busy || configuring;
  useNativeSurface(
    nativeField,
    {
      kind: "composer",
      draft,
      editAck,
      expanded,
      editable: connected && !busy && !uncertain && !!agent.threadId,
      placeholder: active ? "Add a follow-up to the queue…" : "Message your agent",
      active,
      canSend: connected && !uploading && !busy && !configuring && !uncertain && !!agent.threadId,
      canStop: connected && !!agent.turnId && !agent.turnId.startsWith("pending:"),
      hasAttachments: !!attachments.length,
      attachEnabled: !!advanced && connected && !busy && !uploading && !uncertain,
      controls: [
        {
          id: "model",
          label: nativeProvider
            ? `${nativeProvider.label ?? agentProviderName(nativeProvider.id)} · Agent and model`
            : "Choose an agent provider",
          icon:
            nativeProviderIcons[
              nativeProvider?.id === agent.provider
                ? (agent.engine ?? agent.provider)
                : (nativeProvider?.id ?? agent.provider)
            ] ?? ("options" as const),
          disabled: controlsDisabled || agent.status === "starting" || nativeModels.switching,
          options: nativeProvider
            ? [
                { id: "__providers__", label: "← Back to providers", selected: false },
                ...(!nativeProvider.error || nativeProvider.models.length
                  ? [
                      ...(nativeProvider.id === agent.provider
                        ? nativeModels.selection.options
                        : modelOptions(nativeProvider.models)
                      ).map((model) => ({
                        id: model.id,
                        label: model.label,
                        selected:
                          nativeProvider.id === agent.provider &&
                          nativeModels.selection.value === model.id,
                      })),
                    ]
                  : []),
              ]
            : nativeModels.providers
                .filter((provider) => !provider.error || provider.models.length)
                .map((provider) => ({
                  id: provider.id,
                  label:
                    (provider.label ?? agentProviderName(provider.id)) +
                    (provider.id === agent.provider ? " · Current chat" : " · Use in this pane"),
                  selected: provider.id === agent.provider,
                })),
        },
        {
          id: "effort",
          label: `Thinking effort: ${settings.effort ?? "Default"}`,
          icon: "brain" as const,
          disabled: controlsDisabled,
          options: [
            {
              id: "",
              label: `Default (${effortModel?.defaultEffort ?? "automatic"})`,
              selected: !settings.effort,
            },
            ...(effortModel?.efforts ?? []).map((effort) => ({
              id: effort,
              label: effort,
              selected: settings.effort === effort,
            })),
          ],
        },
        {
          id: "mode",
          label: `Mode: ${(agent.engine ?? agent.provider) === "codex" ? settings.mode : (settings.nativeMode ?? agent.controls?.currentMode ?? "default")}`,
          icon: "shield" as const,
          disabled: controlsDisabled,
          options:
            (agent.engine ?? agent.provider) !== "codex"
              ? (agent.controls?.modes ?? []).map((mode) => ({
                  id: mode.id,
                  label: mode.label,
                  selected: (settings.nativeMode ?? agent.controls?.currentMode) === mode.id,
                }))
              : [
                  {
                    id: "default",
                    label: "Default permissions · asks for approval",
                    selected: settings.mode === "default",
                  },
                  {
                    id: "auto-review",
                    label: "Auto-review · same sandbox",
                    selected: settings.mode === "auto-review",
                  },
                  {
                    id: "full-access",
                    label: "Full access · no approval prompts",
                    selected: settings.mode === "full-access",
                  },
                ],
        },
        {
          id: "options",
          label: "Conversation options",
          icon: "options" as const,
          disabled: controlsDisabled,
          options: [
            ...(agent.supportsPlan
              ? [
                  {
                    id: "plan",
                    label: "Plan mode · read-only exploration",
                    selected: !!settings.planMode,
                  },
                ]
              : []),
            ...((agent.engine ?? agent.provider) === "codex"
              ? [{ id: "speed:", label: "Default speed", selected: !settings.serviceTier }]
              : []),
            ...(agent.controls?.features ?? []).flatMap((f) =>
              f.options
                ? f.options.map((o) => ({
                    id: `feature:${JSON.stringify([f.id, o.id])}`,
                    label: `${f.label}: ${o.label}`,
                    selected: (settings.features?.[f.id] ?? f.value) === o.id,
                  }))
                : [
                    {
                      id: `feature:${JSON.stringify([f.id, !(settings.features?.[f.id] ?? f.value)])}`,
                      label: `${f.label}: ${(settings.features?.[f.id] ?? f.value) ? "on" : "off"}`,
                      selected: !!(settings.features?.[f.id] ?? f.value),
                    },
                  ],
            ),
            ...(effortModel?.serviceTiers ?? []).map((tier) => ({
              id: `speed:${tier.id}`,
              label: tier.label,
              selected: settings.serviceTier === tier.id,
            })),
          ],
        },
      ].filter(
        (control) =>
          (agent.engine ?? agent.provider) === "codex" ||
          control.id === "model" ||
          (control.id === "effort" && !!effortModel?.efforts.length) ||
          (control.id === "mode" && !!agent.controls?.modes.length) ||
          (control.id === "options" && !!agent.controls?.features.length),
      ),
      context: agent.context?.limit
        ? `${agent.context.used.toLocaleString()} / ${agent.context.limit.toLocaleString()} tokens · ${Math.round((agent.context.used / agent.context.limit) * 100)}% used\n${agent.context.total === null ? "" : agent.context.total.toLocaleString() + " cumulative tokens"}`
        : "Usage will appear after the agent reports it.",
    },
    (event) => {
      if (event.kind === "text") {
        if (
          connected &&
          !busy &&
          !uncertain &&
          agent.threadId &&
          event.sequence > nativeEditSequence.current
        ) {
          nativeEditSequence.current = event.sequence;
          setDraft(event.text);
          setEditAck(event.sequence);
        }
      } else if (event.kind === "focus") setNativeExpanded(event.focused);
      else if (event.kind === "height") setNativeHeight(event.height);
      else if (event.kind === "attachments") {
        if (!advanced || !connected || busy || uploading || uncertain) return;
        if (attachments.length + event.attachments.length > 3)
          setError("Attach up to three files per message.");
        else setAttachments((value) => [...value, ...event.attachments].slice(0, 3));
      } else if (event.kind === "press") {
        if (event.control === "send") {
          // Carry the native field's current value: a final keystroke can race a React render.
          if (!uncertain) void submit({ message: event.text ?? draft, attachments });
        } else if (event.control === "stop") {
          if (connected && agent.turnId && !agent.turnId.startsWith("pending:")) onInterrupt();
        } else if (!controlsDisabled) {
          const value = event.value ?? "";
          if (event.control === "model") {
            if (value === "__providers__") {
              setNativeProviderPage(undefined);
              void nativeModels.load();
            } else if (!nativeProvider) {
              const provider = nativeModels.providers.find(
                (entry) => entry.id === value && !entry.error,
              );
              if (provider) {
                setNativeProviderPage(provider.id);
                void nativeModels.load(provider.id);
              }
            } else if (!value || nativeProvider.models.some((model) => model.id === value)) {
              void nativeModels.choose(value, nativeProvider.id);
            }
          } else if (
            event.control === "effort" &&
            (!value || effortModel?.efforts?.includes(value))
          )
            void configure({ ...settings, effort: value || null });
          else if (
            event.control === "mode" &&
            (agent.engine ?? agent.provider) === "codex" &&
            ["default", "auto-review", "full-access"].includes(value)
          )
            void configure({ ...settings, mode: value as AgentSettings["mode"] });
          else if (event.control === "mode" && agent.controls?.modes.some((m) => m.id === value))
            void configure({ ...settings, nativeMode: value });
          else if (event.control === "options") {
            if (value.startsWith("feature:")) {
              const [id, next] = JSON.parse(value.slice(8)) as [string, boolean | string];
              if (agent.controls?.features.some((f) => f.id === id))
                void configure({ ...settings, features: { ...settings.features, [id]: next } });
              return;
            }
            if (value === "plan" && agent.supportsPlan)
              void configure({ ...settings, planMode: !settings.planMode });
            else if (
              value.startsWith("speed:") &&
              (!value.slice(6) ||
                effortModel?.serviceTiers?.some((tier) => tier.id === value.slice(6)))
            )
              void configure({ ...settings, serviceTier: value.slice(6) || null });
          }
        }
      }
    },
  );
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
      {(agent.engine ?? agent.provider) === "codex" && !!effortModel?.serviceTiers?.length && (
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
        aria-label="Start dictation"
        title={
          compact
            ? "Use dictation on your phone's keyboard."
            : dictation.supported
              ? "Dictate a message. Stop to review, edit, or press Enter to send. Uses your browser's speech service."
              : "Dictation is not supported by this browser."
        }
        disabled={
          (!compact && !dictation.supported) ||
          !connected ||
          busy ||
          uncertain ||
          uploading ||
          configuring ||
          !agent.threadId ||
          draft.length >= 16000
        }
        onClick={() => {
          if (compact) {
            textarea.current?.focus();
            setKeyboardHelp((value) => !value);
          } else {
            dictationBase.current = draft;
            dictation.start();
          }
        }}
        className="agent-control text-muted-foreground hover:bg-muted"
      >
        <Mic className="size-4" />
      </button>
    </>
  );
  return (
    <ComposerSurfaceContext value={owner}>
      <div className="space-y-2">
        {!dictation.active &&
          active &&
          agent.controls?.steer &&
          !!draft.trim() &&
          !attachments.length && (
            <button
              type="button"
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
              disabled={
                !connected ||
                busy ||
                uncertain ||
                !agent.turnId ||
                agent.turnId.startsWith("pending:") ||
                draft.trim().startsWith("/")
              }
              onClick={() => void submit({ message: draft, attachments: [] }, false, true)}
            >
              Steer the current turn
            </button>
          )}
        {durableQueue && !!agent.queue?.length && (
          <div data-composer-queue className="max-h-28 space-y-2 overflow-y-auto">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{agent.queuePaused ? "Queue paused" : "Follow-ups run on this machine"}</span>
              <button
                type="button"
                disabled={!connected}
                onClick={() =>
                  void queueAction({
                    kind: "queue-pause",
                    sessionId: agent.id,
                    paused: !agent.queuePaused,
                  })
                }
              >
                {agent.queuePaused ? "Resume queue" : "Pause queue"}
              </button>
            </div>
            {agent.queue.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs"
              >
                <span className="text-muted-foreground">Queued</span>
                <span className="min-w-0 flex-1 truncate">
                  {entry.text || entry.attachments.map((a) => a.name).join(", ")}
                </span>
                <button
                  type="button"
                  aria-label="Remove queued message"
                  disabled={!connected}
                  onClick={() =>
                    void queueAction({ kind: "queue-remove", sessionId: agent.id, id: entry.id })
                  }
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {!durableQueue && !!queue.length && (
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
        {(error || dictation.error || nativeModels.error) && (
          <p role="alert" className="text-xs text-destructive">
            {error ?? dictation.error ?? nativeModels.error}
          </p>
        )}
        {uncertain && (
          <div data-composer-delivery className="flex items-center gap-2 text-xs">
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
          data-native-composer={native || undefined}
          data-composer-surface={owner}
          data-expanded={compact ? expanded : undefined}
          onSubmit={(e) => {
            e.preventDefault();
            if (!uncertain) {
              if (dictation.active) dictation.stop("send");
              else void submit();
            }
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy && !uncertain && !dictation.active) void addFiles(e.dataTransfer.files);
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
          {dictation.active ? (
            <DictationRecording
              state={dictation}
              onStop={dictation.stop}
              onCancel={dictation.cancel}
              canSend={
                connected && !busy && !uncertain && !uploading && !configuring && !!agent.threadId
              }
              queued={active}
            />
          ) : native ? (
            <div ref={nativeField} aria-hidden="true" style={{ height: nativeHeight }} />
          ) : (
            <>
              <textarea
                ref={textarea}
                data-agent-composer
                aria-label={`Message ${agentProviderName(agent.provider)}`}
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
                  if (
                    e.key === "Tab" &&
                    e.shiftKey &&
                    !configuring &&
                    advanced &&
                    (agent.engine ?? agent.provider) === "codex"
                  ) {
                    e.preventDefault();
                    const modes: AgentSettings["mode"][] = [
                      "default",
                      "auto-review",
                      "full-access",
                    ];
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
                className="agent-composer-input max-h-48 min-h-16 w-full resize-none bg-transparent px-3 py-3 outline-none disabled:opacity-50"
              />
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
                  <AgentModelPicker
                    agent={agent}
                    showValue={!compact}
                    disabled={controlsDisabled}
                    onSelect={(model) =>
                      void configure({
                        ...settings,
                        model,
                        effort: null,
                        serviceTier: null,
                        features: {},
                      })
                    }
                  />
                  {!!effortModel?.efforts.length && (
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
                  )}
                  {!!agent.controls?.modes.length &&
                    (agent.engine ?? agent.provider) !== "codex" && (
                      <ControlPicker
                        label="Agent mode"
                        showValue={!compact}
                        value={settings.nativeMode ?? agent.controls.currentMode ?? ""}
                        icon={<Shield className="size-4" />}
                        disabled={controlsDisabled}
                        options={agent.controls.modes}
                        onSelect={(nativeMode) => void configure({ ...settings, nativeMode })}
                      />
                    )}
                  {(agent.controls?.features ?? []).map((feature) => (
                    <ControlPicker
                      key={feature.id}
                      label={feature.label}
                      showValue={!compact}
                      value={String(settings.features?.[feature.id] ?? feature.value)}
                      icon={<SlidersHorizontal className="size-4" />}
                      disabled={controlsDisabled}
                      options={
                        feature.options ?? [
                          { id: "true", label: "On" },
                          { id: "false", label: "Off" },
                        ]
                      }
                      onSelect={(value) =>
                        void configure({
                          ...settings,
                          features: {
                            ...settings.features,
                            [feature.id]: feature.options ? value : value === "true",
                          },
                        })
                      }
                    />
                  ))}
                  {(agent.engine ?? agent.provider) === "codex" && (
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
                  )}
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
            </>
          )}
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
