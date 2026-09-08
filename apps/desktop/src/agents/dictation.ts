import { useEffect, useRef, useState } from "react";
interface SpeechResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechEvent {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechResult };
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
export function useDictation(onText: (text: string) => void) {
  const recognition = useRef<Recognition | null>(null);
  const append = useRef(onText);
  useEffect(() => {
    append.current = onText;
  }, [onText]);
  const [listening, setListening] = useState(false),
    [interim, setInterim] = useState(""),
    [error, setError] = useState<string | null>(null);
  const Constructor =
    typeof window === "undefined"
      ? undefined
      : ((window as SpeechWindow).SpeechRecognition ??
        (window as SpeechWindow).webkitSpeechRecognition);
  useEffect(
    () => () => {
      recognition.current?.abort();
    },
    [],
  );
  const toggle = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    if (!Constructor) return;
    setError(null);
    const speech = new Constructor();
    recognition.current = speech;
    speech.continuous = true;
    speech.interimResults = true;
    speech.lang = navigator.language;
    speech.onresult = (event) => {
      let partial = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        if (result.isFinal) append.current(result[0].transcript);
        else partial += result[0].transcript;
      }
      setInterim(partial);
    };
    speech.onerror = (event) => {
      setError(
        event.error === "not-allowed"
          ? "Allow microphone access to use dictation."
          : `Dictation stopped: ${event.error}`,
      );
      setListening(false);
      setInterim("");
    };
    speech.onend = () => {
      setListening(false);
      setInterim("");
    };
    try {
      speech.start();
      setListening(true);
    } catch {
      setError("Could not start dictation.");
    }
  };
  return { supported: !!Constructor, listening, interim, error, toggle };
}
