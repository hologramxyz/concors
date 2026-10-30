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
  File as FileIcon,
  RotateCw,
  CircleAlert,
  ClipboardPaste,
} from "lucide-react";
import {
  agentProviderName,
  AgentAttachmentSchema,
  MAX_AGENT_IMAGE_BYTES,
  MAX_MESSAGE_ATTACHMENTS,
  MAX_UPLOAD_BYTES,
  type AgentInfo,
  type AgentSettings,
  type AgentAttachment,
  type AgentProviderId,
  type AgentOperation,
  type AgentCommand,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { submitAgentInput } from "./paseo/submit";
import { ControlPicker } from "./control-picker";
import { Popover } from "radix-ui";
import { ContextMeter } from "./context-meter";
import { usageView } from "./context-window";
import { usePlanUsage } from "./use-plan-usage";
import { AgentModelPicker } from "./model-picker";
import { ControlTooltip } from "./control-tooltip";
import { useAgents } from "./context";
import { switchDescription } from "./provider-switch";
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
import { matchCommands, needsArguments, slashQuery } from "./slash-commands";
import { SlashCommandMenu } from "./slash-menu";
import { clipboardHasImage, readClipboardImage } from "@/tauri";
import { carriesFiles } from "@/window/file-drops";
import { ATTACHMENT_LIMIT_BYTES, fileBase64, fitImage, fitImageFile } from "./image-attachment";
import { ImageViewer } from "./attachment-preview";
import { useFollowUpMode } from "./follow-ups";
import { MOD_KEY } from "@/lib/platform";
import { useCommand } from "@/shortcuts/context";
import { useShortcutLabels } from "@/shortcuts/preferences-context";
import { rememberSentAttachments } from "./attachment-cache";
import {
  filePreview,
  forgetFile,
  hasFile,
  isUpload,
  keepFile,
  messageFiles,
  startUpload,
  stopUpload,
  unsent,
  uploading,
  useUploadProgress,
  useUploadsVersion,
  type DraftAttachment,
  type UploadAttachment,
  type UploadOutcome,
} from "./attachment-uploads";
/** What an older machine is told when a file is past its limits; it has no uploads. */
const UPDATE_FOR_MORE = "This machine needs a Concors update to attach more or larger files.";
const UPLOAD_LIMIT = `${MAX_UPLOAD_BYTES / 1024 / 1024} MB`;
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
  reachable = connected,
  onInterrupt,
  onSend,
  placeholder,
}: {
  agent: AgentInfo;
  connected: boolean;
  /**
   * The machine itself is connected. `connected` is also false while a chat action runs, which
   * must not end dictation or blame the connection.
   */
  reachable?: boolean;
  onInterrupt: () => void;
  /** The user sent or queued a message: show the bottom of the chat. */
  onSend?: () => void;
  /** Replaces the idle prompt, as the start screen does under its own heading. */
  placeholder?: string | undefined;
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
  // How many files are being read; they show as placeholder tiles until they are attached.
  const [reading, setReading] = useState(0);
  // While files are read, before they are attached (and, on a machine with uploads, uploaded).
  const [attaching, setAttaching] = useState(false),
    [configuring, setConfiguring] = useState(false),
    [error, setError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null),
    picker = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const shortcutLabel = useShortcutLabels();
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
  const followUps = useFollowUpMode();
  const queueSteer =
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes("agent-queue-steer");
  // Files go to the machine as they are attached; an older machine takes three of 1 MB inline.
  const uploads = !!connection?.uploads;
  // Attachments still uploading, or stopped, hold the message back until they are sent or removed.
  const waiting = unsent(attachments);
  const failedUpload = attachments.find(
    (file): file is UploadAttachment => isUpload(file) && !!file.error,
  );
  const active = ["starting", "working", "needs_input"].includes(agent.status);
  // A message sent while its attachments upload waits for them. Its text is locked meanwhile, so
  // what goes is what was sent; removing a slow file still sends the rest sooner. "Don't send yet"
  // (or Escape) unlocks it.
  const [deferred, setDeferred] = useState<{ alternate: boolean } | null>(null);
  /**
   * Whether a follow-up can go into the running turn now, as the Codex app's Steer does. One with
   * attachments can when the agent takes them mid-turn (Codex, Claude Code); elsewhere it queues.
   */
  const canSteer = (text: string, files: number) =>
    agent.status === "working" &&
    !!agent.controls?.steer &&
    !!agent.turnId &&
    !agent.turnId.startsWith("pending:") &&
    (!!text.trim() || files > 0) &&
    !text.trim().startsWith("/") &&
    (!files || !!agent.controls.steerAttachments);
  const showStop = active && (!compact || (!draft.trim() && !attachments.length));
  const sendLabel = !active
    ? "Send message"
    : followUps === "steer" && canSteer(draft, attachments.length)
      ? "Steer message"
      : "Queue message";
  const settings = agent.settings ?? defaults;
  const dictationBase = useRef("");
  const wasDictating = useRef(false);
  const restoreDictationFocus = useRef(false);
  const dictation = useDictation(
    {
      onTranscript: (text) => setDraft(appendDictation(dictationBase.current, text)),
      onFinish: (text, action) => {
        const message = appendDictation(dictationBase.current, text);
        setDraft(message);
        // Send goes the normal way, steering or queueing behind a running turn; Edit leaves it.
        if (action === "send" && connected && !uncertain) void followUp({ message, attachments });
      },
      onCancel: () => setDraft(dictationBase.current),
    },
    visible,
    reachable,
    connection,
  );
  const canDictate =
    (compact || (dictation.supported && !dictation.preparing)) &&
    connected &&
    !busy &&
    !uncertain &&
    !attaching &&
    !configuring &&
    !deferred &&
    !!agent.threadId &&
    draft.length < 16000;
  const startDictation = () => {
    dictationBase.current = draft;
    dictation.start();
  };
  useCommand(
    "start-dictation",
    visible && !compact && canDictate,
    () => {
      if (!dictation.active) startDictation();
    },
    () => !!form.current?.closest("[data-pane-id]")?.contains(document.activeElement),
  );
  useLayoutEffect(() => {
    const el = textarea.current;
    if (el) {
      // Hold the box's size while measuring: collapsing it for one layout grew the chat above,
      // which clamped its scroll up and left it there.
      const box = el.parentElement;
      if (box) box.style.minHeight = `${box.offsetHeight}px`;
      el.style.height = "auto";
      // The class's max-height caps the growth; past it the text scrolls.
      el.style.height = el.scrollHeight + "px";
      if (box) box.style.minHeight = "";
    }
  }, [draft, expanded, dictation.active]);
  // Runs after the box is sized: the dictated words were added at the end, so show the end.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (wasDictating.current && !dictation.active) restoreDictationFocus.current = true;
    wasDictating.current = dictation.active;
    if (!visible || document.hidden || dictation.active) restoreDictationFocus.current = false;
    // Escape can cancel dictation while an interrupt temporarily disables the input. Keep the
    // focus request until it is editable, unless the user has moved to another control or pane.
    if (restoreDictationFocus.current && el && !el.disabled) {
      restoreDictationFocus.current = false;
      if (
        document.activeElement === document.body ||
        form.current?.contains(document.activeElement)
      ) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [dictation.active, visible, connected, busy, uncertain, agent.threadId]);
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
        ...messageFiles(input.attachments),
      },
    };
    attemptRef.current = next;
    // In the order the chat lists them: inline files, then uploaded ones.
    const listed = [
      ...input.attachments.filter((file) => !isUpload(file)),
      ...input.attachments.filter(isUpload),
    ];
    rememberSentAttachments(
      agent.id,
      next.id,
      listed.map((file) => (isUpload(file) ? filePreview(file.id) : file)),
    );
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
      // The machine has the files now; the bytes kept to upload them are no longer needed.
      for (const file of input.attachments) if (isUpload(file)) forgetFile(file.id);
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
    if (unsent(input.attachments)) {
      setError(
        input.attachments.some((file) => isUpload(file) && file.error)
          ? "Remove or retry the attachments that did not upload."
          : "Wait for the attachments to finish uploading.",
      );
      return;
    }
    sendingRef.current = true;
    const canSubmit = connected && !busy && !attaching && !configuring && !!agent.threadId;
    if (canSubmit && !queued && (input.message.trim() || input.attachments.length)) onSend?.();
    try {
      return await submitAgentInput({
        message: input.message,
        attachments: input.attachments,
        canSubmit,
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
  // A message whose delivery was unknown when the connection dropped goes again once it is back.
  // The machine keeps a receipt for its request ID, so a message that did arrive is not sent twice.
  const wasConnected = useRef(connected);
  useEffect(() => {
    const reconnected = connected && !wasConnected.current;
    wasConnected.current = connected;
    const attempt = attemptRef.current;
    if (reconnected && uncertain && attempt)
      void submit(attempt.draft, queue.includes(attempt.draft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);
  /**
   * Sends a message the way the Follow-ups setting says, or the other way when `alternate`
   * (⌘/Ctrl+Enter): into the running turn, or onto the queue. Messages that cannot steer queue.
   */
  const followUp = (input: Draft = { message: draft, attachments }, alternate = false) => {
    if (unsent(input.attachments) && !input.attachments.some((f) => isUpload(f) && f.error)) {
      setDeferred({ alternate });
      return Promise.resolve(undefined);
    }
    return submit(
      input,
      false,
      active &&
        (followUps === "steer") !== alternate &&
        canSteer(input.message, input.attachments.length),
    );
  };
  useEffect(() => {
    if (!deferred || (waiting && !failedUpload)) return;
    // The uploads settled outside React (the machine answered); the wait ends with them.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeferred(null);
    if (!failedUpload) void followUp(undefined, deferred.alternate);
    // Runs when the uploads settle; followUp reads the composer as it is then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferred, waiting, failedUpload]);
  // Escape hides the list for the exact draft it was pressed on; typing brings it back.
  const [slashDismissed, setSlashDismissed] = useState<string | null>(null);
  const [slashActive, setSlashActive] = useState(0);
  const slashTyped = slashQuery(draft);
  const slashCommands =
    slashTyped === null ||
    native ||
    dictation.active ||
    slashDismissed === draft ||
    !connected ||
    busy ||
    uncertain ||
    !agent.threadId
      ? []
      : matchCommands(agent.controls?.commands ?? [], slashTyped);
  const slashIndex = Math.min(slashActive, slashCommands.length - 1);
  const chooseCommand = (command: AgentCommand, complete = false) => {
    setSlashActive(0);
    if (complete || needsArguments(command)) {
      setDraft(`/${command.name} `);
      textarea.current?.focus();
    } else void submit({ message: `/${command.name}`, attachments });
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
  /**
   * Attaches files to upload: each starts uploading at once (see the effect below), and one too
   * large is refused on its own. Images are shrunk only past what an agent takes as an image.
   */
  const addUploads = async (files: File[]) => {
    const refused: string[] = [];
    const added: UploadAttachment[] = [];
    // Only a sanity bound, so one message cannot be made enormous.
    const room = MAX_MESSAGE_ATTACHMENTS - attachments.length;
    if (files.length > room) {
      refused.push(`A message can carry up to ${MAX_MESSAGE_ATTACHMENTS} files.`);
      files = files.slice(0, Math.max(0, room));
    }
    for (const original of files) {
      const file = await fitImageFile(original, MAX_AGENT_IMAGE_BYTES).catch(() => original);
      if (file.size > MAX_UPLOAD_BYTES) {
        refused.push(`${original.name} is larger than ${UPLOAD_LIMIT}.`);
        continue;
      }
      const id = crypto.randomUUID();
      await keepFile(id, file);
      const mime = file.type || "application/octet-stream";
      added.push({ id, name: file.name, mime, size: file.size, upload: null });
    }
    if (added.length) setAttachments((value) => [...value, ...added]);
    if (refused.length) setError(refused.join(" "));
  };
  const attachFiles = async (load: () => Promise<File[]>) => {
    if (attaching || !advanced) return;
    setAttaching(true);
    setReading(1);
    setError(null);
    try {
      const files = await load();
      setReading(files.length);
      if (uploads) return await addUploads(files);
      if (attachments.length + files.length > 3)
        throw new Error(`Attach up to three files per message. ${UPDATE_FOR_MORE}`);
      const incoming: AgentAttachment[] = [];
      for (const original of files) {
        const file = await fitImageFile(original);
        if (file.size > ATTACHMENT_LIMIT_BYTES)
          throw new Error(`${file.name} is larger than 1 MB. ${UPDATE_FOR_MORE}`);
        const data = await fileBase64(file);
        incoming.push({ name: file.name, mime: file.type || "application/octet-stream", data });
      }
      setAttachments((value) => [...value, ...incoming].slice(0, 3));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not attach files");
    } finally {
      setAttaching(false);
      setReading(0);
    }
  };
  const settleUpload = (id: string, outcome: UploadOutcome) => {
    if ("interrupted" in outcome) return;
    setAttachments((list) =>
      list.map((file) =>
        !isUpload(file) || file.id !== id
          ? file
          : "upload" in outcome
            ? { id, name: file.name, mime: file.mime, size: file.size, upload: outcome.upload }
            : { ...file, error: outcome.error },
      ),
    );
  };
  // Uploads attached files, and starts again those a dropped connection or a closed composer
  // stopped. One whose bytes are gone (the app reloaded) has to be attached again.
  const uploadsVersion = useUploadsVersion();
  useEffect(() => {
    if (!connection?.uploads || !reachable) return;
    for (const file of attachments) {
      if (!isUpload(file) || file.upload || file.error || uploading(file.id)) continue;
      if (hasFile(file.id))
        startUpload(connection, file, (outcome) => settleUpload(file.id, outcome));
      else settleUpload(file.id, { error: "Attach this file again." });
    }
    // settleUpload only writes to the draft store, which is the same for this agent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, uploads, reachable, attachments, uploadsVersion]);
  const shown = useRef(attachments);
  useEffect(() => {
    shown.current = attachments;
  }, [attachments]);
  useEffect(
    () => () => {
      // Closing the composer stops its uploads; the draft keeps the files, to upload on return.
      for (const file of shown.current) if (isUpload(file) && !file.upload) stopUpload(file.id);
    },
    [],
  );
  const removeAttachment = (index: number) => {
    const removed = attachments[index];
    setAttachments((list) => list.filter((_, i) => i !== index));
    if (!removed || !isUpload(removed)) return;
    forgetFile(removed.id);
    // An uploaded file nothing will send is removed from the machine now, not days later.
    if (removed.upload && connection?.uploads)
      void connection
        .requestUpload({ kind: "cancel", uploadId: removed.upload.uploadId }, crypto.randomUUID())
        .catch(() => undefined);
  };
  const retryUpload = (id: string) =>
    setAttachments((list) =>
      list.map((file) =>
        isUpload(file) && file.id === id
          ? { id, name: file.name, mime: file.mime, size: file.size, upload: null }
          : file,
      ),
    );
  const addFiles = (files: FileList | File[]) => attachFiles(async () => Array.from(files));
  // Only when the paste event carried nothing: see readClipboardImage for why.
  const pasteNativeImage = () =>
    attachFiles(async () => {
      const image = await readClipboardImage();
      return image
        ? [
            await fitImage(
              image,
              "Pasted image",
              uploads ? MAX_AGENT_IMAGE_BYTES : ATTACHMENT_LIMIT_BYTES,
            ),
          ]
        : [];
    });
  // A phone's text field offers no Paste for an image, so the composer does while the clipboard
  // holds one (see readClipboardImage in the mobile platform). Checked as it opens and on return.
  const [clipboardImage, setClipboardImage] = useState(false);
  useEffect(() => {
    // iOS's own composer offers Paste Image in its attach sheet.
    if (!compact || native || !expanded) return;
    let live = true;
    const check = () =>
      void clipboardHasImage().then(
        (has) => live && setClipboardImage(has),
        () => undefined,
      );
    check();
    window.addEventListener("concors-foreground", check);
    return () => {
      live = false;
      window.removeEventListener("concors-foreground", check);
    };
  }, [compact, native, expanded]);
  const agents = useAgents();
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
    // Preload the catalog so the native picker can display it immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, connected, agent.id]);
  const planUsage = usePlanUsage(agent.provider);
  const nativeProvider = nativeModels.providers.find(
    (provider) => provider.id === nativeProviderPage,
  );
  const effortModel = findAgentModel(nativeModels.currentModels, nativeModels.selection.value);
  const controlsDisabled = !advanced || !connected || busy || configuring;
  // Same conditions as the attach button; while they fail, the window refuses the drop.
  const canDrop =
    !!advanced &&
    connected &&
    !busy &&
    !attaching &&
    !uncertain &&
    !deferred &&
    !dictation.active &&
    !native;
  // dragenter and dragleave fire for every child the pointer crosses, so count them.
  const dragDepth = useRef(0);
  const [dropping, setDropping] = useState(false);
  useNativeSurface(
    nativeField,
    {
      kind: "composer",
      draft,
      editAck,
      expanded,
      editable: connected && !busy && !uncertain && !deferred && !!agent.threadId,
      placeholder: active
        ? followUps === "steer" && canSteer("steer", 0)
          ? "Steer the current turn…"
          : "Add a follow-up to the queue…"
        : "Message your agent",
      active,
      canSend:
        connected &&
        !attaching &&
        !failedUpload &&
        !deferred &&
        !busy &&
        !configuring &&
        !uncertain &&
        !!agent.threadId,
      canStop: connected && !!agent.turnId && !agent.turnId.startsWith("pending:"),
      hasAttachments: !!attachments.length,
      attachEnabled: !!advanced && connected && !busy && !attaching && !uncertain,
      uploads,
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
                {
                  id: "__providers__",
                  label: "← Back to providers",
                  selected: false,
                  navigate: true,
                },
                // Choosing it opens a chat that offers to install the CLI.
                ...(nativeProvider.installed === false
                  ? [
                      {
                        id: "",
                        label: `Install ${nativeProvider.label ?? agentProviderName(nativeProvider.id)}`,
                        selected: false,
                      },
                    ]
                  : []),
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
                    (provider.installed === false
                      ? " · Not installed"
                      : ` · ${switchDescription(agents, agent, provider.id)}`),
                  selected: provider.id === agent.provider,
                  navigate: true,
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
      usage: usageView(agent, planUsage),
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
        if (!advanced || !connected || busy || attaching || uncertain) return;
        if (uploads)
          void addUploads(
            event.attachments.map(
              (file) => new File([fromBase64(file.data)], file.name, { type: file.mime }),
            ),
          ).catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : "Could not attach files"),
          );
        else if (attachments.length + event.attachments.length > 3)
          setError(`Attach up to three files per message. ${UPDATE_FOR_MORE}`);
        else if (!event.attachments.every((file) => AgentAttachmentSchema.safeParse(file).success))
          setError(`Each file can be at most 1 MB. ${UPDATE_FOR_MORE}`);
        else setAttachments((value) => [...value, ...event.attachments].slice(0, 3));
      } else if (event.kind === "press") {
        if (event.control === "send") {
          // Carry the native field's current value: a final keystroke can race a React render.
          if (!uncertain) void followUp({ message: event.text ?? draft, attachments });
        } else if (event.control === "stop") {
          if (connected && agent.turnId && !agent.turnId.startsWith("pending:")) onInterrupt();
        } else if (event.control === "context" || event.control === "context-refresh") {
          // Like the desktop popover: plan usage is read while the sheet is open, not before.
          planUsage.refresh(agent.id, event.control === "context-refresh");
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
        <ControlTooltip
          text={`Plan mode${settings.planMode ? " (on)" : ""}: explore and plan with read-only access`}
        >
          <button
            type="button"
            aria-label="Plan mode"
            aria-pressed={!!settings.planMode}
            className={`agent-control ${settings.planMode ? "bg-primary/10 text-primary!" : ""}`}
            disabled={!connected || busy || configuring}
            onClick={() => void configure({ ...settings, planMode: !settings.planMode })}
          >
            <ListTodo className="size-4" />
          </button>
        </ControlTooltip>
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
      <ContextMeter agent={agent} />
      <ControlTooltip
        text={
          compact
            ? "Use dictation on your phone's keyboard."
            : (dictation.preparing ??
              (dictation.supported
                ? "Dictate a message"
                : "Dictation is not supported by this browser."))
        }
        shortcut={
          !compact && shortcutLabel("start-dictation") !== "Unassigned"
            ? shortcutLabel("start-dictation")
            : undefined
        }
      >
        <button
          type="button"
          aria-label="Start dictation"
          disabled={!canDictate}
          onClick={() => {
            if (compact) {
              textarea.current?.focus();
              setKeyboardHelp((value) => !value);
            } else {
              startDictation();
            }
          }}
          className="agent-control text-muted-foreground hover:bg-muted"
        >
          <Mic className="size-4" />
        </button>
      </ControlTooltip>
    </>
  );
  return (
    <ComposerSurfaceContext value={owner}>
      <div className="space-y-2">
        {!dictation.active && !compact && active && canSteer(draft, attachments.length) && (
          <p data-follow-up-hint className="px-2 text-xs text-muted-foreground">
            {followUps === "steer"
              ? `Enter steers the current turn · ${MOD_KEY}+Enter queues it for after`
              : `Enter queues it for after this turn · ${MOD_KEY}+Enter steers the current turn`}
          </p>
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
                {queueSteer && canSteer(entry.text, entry.attachments.length) && (
                  <button
                    type="button"
                    className="text-primary"
                    title="Send it into the current turn now instead of after it"
                    disabled={!connected}
                    onClick={() =>
                      void queueAction({
                        kind: "queue-steer",
                        sessionId: agent.id,
                        id: entry.id,
                        turnId: agent.turnId ?? "",
                      })
                    }
                  >
                    Steer
                  </button>
                )}
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
                {connected &&
                  !busy &&
                  !uncertain &&
                  canSteer(entry.message, entry.attachments.length) && (
                    <button
                      type="button"
                      className="text-primary"
                      title="Send it into the current turn now instead of after it"
                      onClick={() => void submit(entry, true, true)}
                    >
                      Steer
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
        {(error || dictation.error || nativeModels.error || failedUpload) && (
          <p role="alert" className="text-xs text-destructive">
            {error ??
              dictation.error ??
              nativeModels.error ??
              (failedUpload && `${failedUpload.name}: ${failedUpload.error}`)}
          </p>
        )}
        {deferred && (
          <div data-composer-deferred className="flex items-center gap-2 text-xs">
            <span role="status">Sending once the attachments finish uploading…</span>
            <button className="text-primary" onClick={() => setDeferred(null)}>
              Don’t send yet
            </button>
          </div>
        )}
        {uncertain && (
          <div data-composer-delivery className="flex items-center gap-2 text-xs">
            <span>Your message may not have arrived.</span>
            <button
              className="text-primary"
              onClick={() =>
                void submit(
                  attemptRef.current?.draft,
                  !!attemptRef.current && queue.includes(attemptRef.current.draft),
                )
              }
            >
              Send again
            </button>
            {/* Without this, a retry that keeps failing would leave the message locked for good. */}
            <button
              className="text-primary"
              onClick={() => {
                // The message stays where it was, now editable: in the composer, or in the queue.
                attemptRef.current = null;
                setUncertain(false);
                setError(null);
              }}
            >
              Edit message
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
              if (dictation.active) dictation.stop();
              else void followUp();
            }
          }}
          onDragEnter={(e) => {
            if (!canDrop || !carriesFiles(e.dataTransfer)) return;
            dragDepth.current++;
            setDropping(true);
          }}
          onDragLeave={(e) => {
            if (!carriesFiles(e.dataTransfer) || dragDepth.current === 0) return;
            if (--dragDepth.current === 0) setDropping(false);
          }}
          onDragOver={(e) => {
            if (!canDrop || !carriesFiles(e.dataTransfer)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            dragDepth.current = 0;
            setDropping(false);
            if (!canDrop || !carriesFiles(e.dataTransfer)) return;
            e.preventDefault();
            const { files, folders } = droppedFiles(e.dataTransfer);
            if (files.length) void addFiles(files);
            else if (folders)
              setError("Folders cannot be attached. Drop the files inside instead.");
          }}
          data-dropping={dropping || undefined}
          className={`relative rounded-2xl border bg-background p-2 shadow-sm focus-within:border-primary/40 data-[dropping]:border-primary ${compact ? "mobile-composer" : "agent-composer-form"}`}
        >
          {dropping && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/90 text-sm font-medium text-primary"
            >
              Drop files to attach
            </div>
          )}
          {(attachments.length > 0 || reading > 0) && (
            <div data-composer-attachments className="flex flex-wrap gap-2 px-2 pt-1 pb-2">
              {attachments.map((file, i) => (
                <AttachmentChip
                  key={isUpload(file) ? file.id : i}
                  file={file}
                  compact={!!compact}
                  disabled={busy || uncertain}
                  onRemove={() => removeAttachment(i)}
                  {...(isUpload(file) && file.error && hasFile(file.id)
                    ? { onRetry: () => retryUpload(file.id) }
                    : {})}
                />
              ))}
              {Array.from({ length: reading }, (_, i) => (
                <div
                  key={`reading-${i}`}
                  role="status"
                  aria-label="Reading attachment"
                  data-composer-attachment-reading
                  className="flex size-12 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground"
                >
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
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
                connected && !busy && !uncertain && !attaching && !configuring && !!agent.threadId
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
                    : !active && placeholder
                      ? placeholder
                      : active
                        ? followUps === "steer" && canSteer("steer", 0)
                          ? "Steer the current turn…"
                          : "Add a follow-up to the queue…"
                        : "Reply…"
                }
                value={draft}
                rows={compact && !expanded ? 1 : 2}
                onFocus={compact ? expand : undefined}
                onClick={compact ? expand : undefined}
                enterKeyHint={compact ? "enter" : "send"}
                maxLength={16000}
                disabled={!connected || busy || uncertain || !agent.threadId}
                // Read-only, not disabled, so focus stays here for Escape and for typing after.
                readOnly={!!deferred}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setSlashActive(0);
                  dictation.dismissError();
                }}
                onPaste={(e) => {
                  if (deferred) return;
                  if (e.clipboardData.files.length) {
                    e.preventDefault();
                    void addFiles(e.clipboardData.files);
                    // A web view can paste an image as no text and no file: read it natively.
                  } else if (!e.clipboardData.getData("text/plain")) void pasteNativeImage();
                }}
                onKeyDown={(e) => {
                  if (deferred) {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setDeferred(null);
                    } else if (e.key === "Enter") e.preventDefault();
                    return;
                  }
                  const command = slashCommands[slashIndex];
                  if (command && !e.nativeEvent.isComposing) {
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      // The list stacks upward from the best match, so Up reaches further ones.
                      const step = e.key === "ArrowUp" ? 1 : -1;
                      setSlashActive(
                        (slashIndex + step + slashCommands.length) % slashCommands.length,
                      );
                      return;
                    }
                    if ((e.key === "Enter" && !e.shiftKey) || (e.key === "Tab" && !e.shiftKey)) {
                      e.preventDefault();
                      if (!uncertain) chooseCommand(command, e.key === "Tab");
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setSlashDismissed(draft);
                      return;
                    }
                  }
                  if (
                    e.key === "Tab" &&
                    e.shiftKey &&
                    !e.ctrlKey &&
                    !e.metaKey &&
                    !e.altKey &&
                    !e.nativeEvent.isComposing &&
                    !e.repeat &&
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
                    // On a phone ⌘/Ctrl+Enter is how a keyboard sends at all, not the other way.
                    if (!uncertain) void followUp(undefined, !compact && (e.metaKey || e.ctrlKey));
                  }
                }}
                className={`agent-composer-input ${compact ? "max-h-48" : "max-h-[min(40cqh,26rem)]"} min-h-16 w-full resize-none bg-transparent px-3 py-3 outline-none read-only:opacity-50 disabled:opacity-50`}
              />
              <div
                className={`flex items-center gap-1 px-1 ${compact ? "mobile-composer-toolbar" : "agent-composer-toolbar"}`}
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
                <ControlTooltip
                  text={
                    uploads
                      ? `Attach files · up to ${UPLOAD_LIMIT} each`
                      : "Attach files · up to three, 1 MB each"
                  }
                >
                  <button
                    type="button"
                    aria-label="Attach files"
                    className="agent-control mobile-composer-attach"
                    disabled={
                      !advanced || !connected || busy || attaching || uncertain || !!deferred
                    }
                    onClick={() => picker.current?.click()}
                  >
                    <Plus className="size-4" />
                  </button>
                </ControlTooltip>
                {compact && clipboardImage && (
                  <button
                    type="button"
                    aria-label="Paste image"
                    className="agent-control"
                    disabled={
                      !advanced || !connected || busy || attaching || uncertain || !!deferred
                    }
                    onClick={() => void pasteNativeImage()}
                  >
                    <ClipboardPaste className="size-4" />
                  </button>
                )}
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
                      shortcut="Shift+Tab"
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
                      <ControlTooltip text="Plan mode and speed">
                        <Popover.Trigger
                          type="button"
                          className="agent-control"
                          aria-label="More composer options"
                        >
                          <SlidersHorizontal className="size-4" />
                        </Popover.Trigger>
                      </ControlTooltip>
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
                <div className="mobile-composer-primary ml-auto flex shrink-0 items-center gap-1">
                  {!compact && utilityControls}
                  {showStop && (
                    <ControlTooltip text="Stop agent" shortcut="Esc">
                      <button
                        type="button"
                        aria-label="Interrupt agent"
                        disabled={
                          !connected || !agent.turnId || agent.turnId.startsWith("pending:")
                        }
                        onClick={onInterrupt}
                        className="rounded-lg border p-2"
                      >
                        <Square className="size-4" />
                      </button>
                    </ControlTooltip>
                  )}
                  {(!compact || !showStop) && (
                    <ControlTooltip
                      text={
                        failedUpload
                          ? "Remove or retry the attachments that did not upload"
                          : waiting
                            ? `${sendLabel} once the attachments finish uploading`
                            : sendLabel
                      }
                      shortcut={compact ? `${MOD_KEY}+Enter` : "Enter"}
                    >
                      <button
                        type="submit"
                        aria-label={sendLabel}
                        disabled={
                          !connected ||
                          attaching ||
                          !!failedUpload ||
                          !!deferred ||
                          busy ||
                          configuring ||
                          uncertain ||
                          (!draft.trim() && !attachments.length) ||
                          !agent.threadId
                        }
                        className="rounded-lg bg-primary p-2 text-primary-foreground disabled:opacity-30"
                      >
                        {busy || deferred ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <ArrowUp className="size-4" />
                        )}
                      </button>
                    </ControlTooltip>
                  )}
                </div>
              </div>
            </>
          )}
        </form>
        <SlashCommandMenu
          anchor={form}
          commands={slashCommands}
          active={slashIndex}
          surface={owner}
          onActive={setSlashActive}
          onChoose={(command) => chooseCommand(command)}
          onDismiss={() => setSlashDismissed(draft)}
        />
        {compact && expanded && keyboardHelp && (
          <p role="status" className="px-2 text-xs text-muted-foreground">
            Use the microphone on your phone’s keyboard to dictate. Review your message before
            sending.
          </p>
        )}
        {compact && (!connected || configuring) && (
          <p role="status" className="px-2 text-xs text-muted-foreground">
            {!connected ? "Reconnecting…" : "Updating agent settings…"}
          </p>
        )}
      </div>
    </ComposerSurfaceContext>
  );
}

/** Dropped folders arrive as empty files that cannot be read, so they are left out and counted. */
function droppedFiles(data: DataTransfer) {
  const files: File[] = [];
  let folders = 0;
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") continue;
    if (item.webkitGetAsEntry()?.isDirectory) folders++;
    else {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return { files, folders };
}

/** A file the native picker read, as bytes again, to upload like any other. */
function fromBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * An attached file in the composer: the image itself when there is one to show, otherwise its
 * name. An uploading file shows how much of it the machine has; one that failed offers a retry
 * when its bytes are still here. Removing it stops its upload.
 */
function AttachmentChip({
  file,
  compact,
  disabled,
  onRemove,
  onRetry,
}: {
  file: DraftAttachment;
  compact: boolean;
  disabled: boolean;
  onRemove: () => void;
  onRetry?: () => void;
}) {
  const upload = isUpload(file) ? file : null;
  const progress = useUploadProgress(upload?.id ?? "");
  const image = isUpload(file)
    ? filePreview(file.id)
    : file.mime.startsWith("image/")
      ? file
      : null;
  const state = !upload
    ? undefined
    : upload.upload
      ? "uploaded"
      : upload.error
        ? "failed"
        : "uploading";
  const percent =
    upload && upload.size ? Math.min(100, Math.round((progress.received / upload.size) * 100)) : 0;
  return (
    <div
      data-composer-attachment
      data-upload={state}
      title={upload?.error ? `${file.name}: ${upload.error}` : file.name}
      className="group relative size-12 shrink-0"
    >
      <div className="relative size-full overflow-hidden rounded-lg border bg-muted/40">
        {image ? (
          <ImageViewer
            file={image}
            name={file.name}
            description="Image attached to the message you are writing."
            downloadable={false}
          >
            <button
              type="button"
              aria-label={`Open ${file.name}`}
              className="block size-full cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <img
                className="size-full object-cover"
                alt={file.name}
                src={`data:${image.mime};base64,${image.data}`}
              />
            </button>
          </ImageViewer>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-0.5 px-1 text-muted-foreground">
            <FileIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="w-full truncate text-center text-[9px]">{file.name}</span>
          </div>
        )}
        {state === "uploading" && (
          <div
            role="progressbar"
            aria-label={`Uploading ${file.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="pointer-events-none absolute inset-0 flex items-end bg-background/50"
          >
            <div
              className="h-1 bg-primary transition-[width]"
              style={{ width: `${Math.max(percent, progress.running ? 4 : 0)}%` }}
            />
          </div>
        )}
        {state === "failed" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 text-destructive">
            {onRetry ? (
              <button
                type="button"
                aria-label={`Retry uploading ${file.name}`}
                title="Retry"
                className="flex size-full items-center justify-center hover:bg-muted/60"
                onClick={onRetry}
              >
                <RotateCw className="size-4" />
              </button>
            ) : (
              <CircleAlert className="size-4" aria-label={`${file.name} did not upload`} />
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        disabled={disabled}
        onClick={onRemove}
        className={`absolute -top-1.5 -left-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-foreground shadow-sm hover:bg-muted focus-visible:opacity-100 disabled:opacity-50 ${compact ? "" : "opacity-0 group-hover:opacity-100"}`}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
