import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { DaemonConnection } from "@concors/daemon-client";
import type { DictationModel } from "@concors/protocol";
import { DaemonRecognition } from "./dictation-daemon";
import {
  DictationSession,
  emptyDictation,
  type DictationAction,
  type Recognition,
} from "./dictation-session";

type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

/** Daemon transcription of a long last utterance can outlast a browser service's final result. */
const DAEMON_FINISH_TIMEOUT_MS = 30_000;

/** Why the microphone is unavailable while the daemon's speech model is not ready, if it is not. */
export function dictationPreparing(model: DictationModel | null): string | null {
  if (!model || model.state === "ready" || model.state === "failed") return null;
  if (model.state === "missing")
    return "Dictation is getting ready on this machine: downloading its speech model.";
  return `Dictation is getting ready on this machine: downloading its speech model (${Math.floor(
    (model.receivedBytes / model.totalBytes) * 100,
  )}%).`;
}

/**
 * Transcription runs on the daemon hosting the agent when it offers dictation, so webviews
 * without a speech service (Linux, Windows) can dictate. Older daemons fall back to the
 * webview's own SpeechRecognition where it exists.
 */
function useDaemonDictation(connection: DaemonConnection | null | undefined) {
  const available = !!connection?.dictation;
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const subscribe = useCallback(
    (changed: () => void) => (available && connection ? connection.onDictation(changed) : noop),
    [available, connection],
  );
  const model = useSyncExternalStore(subscribe, () =>
    available && connection ? connection.dictationModel : null,
  );
  useEffect(() => {
    if (!available || !connection) return;
    // The connection records the answer; the refresh re-reads it.
    void connection
      .requestDictation({ kind: "status" }, crypto.randomUUID())
      .then(refresh)
      .catch(() => undefined);
  }, [available, connection]);
  return { available, model };
}
const noop = () => undefined;

const CONNECTION_DROPPED =
  "Dictation stopped because the connection to this machine dropped. Your words so far are in the message.";

export function useDictation(
  callbacks: {
    onTranscript: (text: string) => void;
    onFinish: (text: string, action: DictationAction) => void;
    onCancel: () => void;
  },
  /** The pane is on screen; switching away stops dictation on purpose. */
  visible: boolean,
  /** The machine is reachable; the recording streams to it, so it cannot outlive the connection. */
  connected: boolean,
  connection?: DaemonConnection | null,
) {
  const current = useRef(callbacks);
  useLayoutEffect(() => {
    current.current = callbacks;
  });
  const session = useRef<DictationSession | null>(null);
  const [state, setState] = useState(emptyDictation);
  const daemon = useDaemonDictation(connection);
  useEffect(() => {
    if (!visible) session.current?.suspend();
  }, [visible]);
  useEffect(() => {
    if (!connected) session.current?.suspend(CONNECTION_DROPPED);
  }, [connected]);
  // Once the machine is back the notice is stale; the words are already in the message.
  const [wasConnected, setWasConnected] = useState(connected);
  if (connected !== wasConnected) {
    setWasConnected(connected);
    if (connected && state.error === CONNECTION_DROPPED) setState({ ...state, error: null });
  }
  const Constructor =
    typeof window === "undefined"
      ? undefined
      : ((window as SpeechWindow).SpeechRecognition ??
        (window as SpeechWindow).webkitSpeechRecognition);
  // Keeps recording while the window is out of view: switching to read something mid-sentence
  // must not end it. Only unmounting the composer does.
  useEffect(() => () => session.current?.dispose(), []);
  return {
    ...state,
    supported: daemon.available || !!Constructor,
    /** Set while the daemon downloads its speech model; the microphone waits for it. */
    preparing: daemon.available ? dictationPreparing(daemon.model) : null,
    active: state.phase !== "idle",
    start: () => {
      if (session.current && session.current.state.phase !== "idle") return;
      const speech =
        daemon.available && connection
          ? () => new DaemonRecognition(connection)
          : Constructor && (() => new Constructor());
      if (!speech) return;
      session.current?.dispose();
      try {
        session.current = new DictationSession(
          speech(),
          {
            change: setState,
            transcript: (text) => current.current.onTranscript(text),
            finish: (text, action) => current.current.onFinish(text, action),
          },
          daemon.available ? DAEMON_FINISH_TIMEOUT_MS : undefined,
        );
        session.current.start(navigator.language);
      } catch {
        setState({ ...emptyDictation, error: "Could not start dictation in this browser." });
      }
    },
    stop: (action?: DictationAction) => session.current?.stop(action),
    suspend: () => session.current?.suspend(),
    /** An ended run's notice only describes that run; editing the message moves past it. */
    dismissError: () =>
      setState((state) =>
        state.phase === "idle" && state.error ? { ...state, error: null } : state,
      ),
    cancel: () => {
      session.current?.dispose();
      session.current = null;
      setState(emptyDictation);
      current.current.onCancel();
    },
  };
}
