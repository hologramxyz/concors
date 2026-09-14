import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
export function useDictation(
  callbacks: {
    onTranscript: (text: string) => void;
    onFinish: (text: string, action: "edit" | "send") => void;
    onCancel: () => void;
  },
  enabled: boolean,
) {
  const current = useRef(callbacks);
  useLayoutEffect(() => {
    current.current = callbacks;
  });
  const session = useRef<DictationSession | null>(null);
  const [state, setState] = useState(emptyDictation);
  useEffect(() => {
    if (!enabled) session.current?.suspend();
  }, [enabled]);
  const Constructor =
    typeof window === "undefined"
      ? undefined
      : ((window as SpeechWindow).SpeechRecognition ??
        (window as SpeechWindow).webkitSpeechRecognition);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) session.current?.suspend();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      session.current?.dispose();
    };
  }, []);
  return {
    ...state,
    supported: !!Constructor,
    active: state.phase !== "idle",
    start: () => {
      if (!Constructor || (session.current && session.current.state.phase !== "idle")) return;
      session.current?.dispose();
      try {
        session.current = new DictationSession(new Constructor(), {
          change: setState,
          transcript: (text) => current.current.onTranscript(text),
          finish: (text, action) => current.current.onFinish(text, action),
        });
        session.current.start(navigator.language);
      } catch {
        setState({ ...emptyDictation, error: "Could not start dictation in this browser." });
      }
    },
    stop: (action: DictationAction) => session.current?.stop(action),
    suspend: () => session.current?.suspend(),
    cancel: () => {
      session.current?.dispose();
      session.current = null;
      setState(emptyDictation);
      current.current.onCancel();
    },
  };
}
