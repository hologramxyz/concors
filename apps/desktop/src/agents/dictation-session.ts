export interface SpeechEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: { isFinal: boolean; 0: { transcript: string } };
  };
}
export interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechEvent) => void) | null;
  /** `message` is shown as-is when present, e.g. the daemon explaining why it cannot dictate. */
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
/** Put the words in the prompt box, or put them there and send them. */
export type DictationAction = "insert" | "send";
export interface DictationState {
  phase: "idle" | "recording" | "stopping";
  transcript: string;
  error: string | null;
}
export const emptyDictation: DictationState = { phase: "idle", transcript: "", error: null };
interface DictationCallbacks {
  change: (state: DictationState) => void;
  transcript: (text: string) => void;
  /**
   * The dictated words, with what to do with them. Only a clean stop the user chose to send
   * sends; a failure, a timeout or leaving the pane always hands the words over to edit.
   */
  finish: (text: string, action: DictationAction) => void;
}

export function appendDictation(draft: string, transcript: string): string {
  return (draft + (draft && transcript && !/\s$/.test(draft) ? " " : "") + transcript).slice(
    0,
    16000,
  );
}

/**
 * One recognition run, ending exactly once by handing its words over: when stopped, when the
 * service ends on its own, and on a failure, which keeps the words captured so far.
 */
export class DictationSession {
  state: DictationState = { ...emptyDictation, phase: "recording" };
  #action: DictationAction = "insert";
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;
  private speech: Recognition;
  private callbacks: DictationCallbacks;
  private finishTimeoutMs: number;
  constructor(speech: Recognition, callbacks: DictationCallbacks, finishTimeoutMs = 5000) {
    this.speech = speech;
    this.callbacks = callbacks;
    this.finishTimeoutMs = finishTimeoutMs;
  }

  start(language: string): void {
    this.speech.continuous = true;
    this.speech.interimResults = true;
    this.speech.lang = language;
    this.speech.onresult = (event) => {
      if (this.#closed || !["recording", "stopping"].includes(this.state.phase)) return;
      // Rebuild the whole result list so revised interim words are replaced, not duplicated.
      const transcript = Array.from(event.results, (result) => result[0].transcript.trim())
        .filter(Boolean)
        .join(" ")
        .slice(0, 16000);
      this.callbacks.transcript(transcript);
      this.#update({ transcript });
    };
    this.speech.onerror = ({ error, message: detail }) => {
      if (this.#closed || !["recording", "stopping"].includes(this.state.phase)) return;
      const message =
        error === "not-allowed" || error === "service-not-allowed"
          ? "Allow microphone access to use dictation."
          : error === "no-speech"
            ? "No speech was detected. Try again or type your message."
            : error === "audio-capture"
              ? "No microphone is available. Check that one is connected and try again."
              : error === "daemon" && detail
                ? detail
                : "Dictation stopped unexpectedly. You can edit the words captured so far.";
      this.#fail(message);
    };
    this.speech.onend = () => {
      if (this.#closed || !["recording", "stopping"].includes(this.state.phase)) return;
      clearTimeout(this.#timer);
      this.#finish();
    };
    this.#update({});
    try {
      this.speech.start();
    } catch {
      this.#fail("Could not start dictation. Check microphone access and try again.");
    }
  }

  /** Waits for the last words, which the service delivers as it ends. */
  stop(action: DictationAction = "insert"): void {
    if (this.#closed || this.state.phase !== "recording") return;
    this.#action = action;
    this.#update({ phase: "stopping" });
    this.#timer = setTimeout(
      () => this.#fail("Dictation could not finish. Check the words it captured."),
      this.finishTimeoutMs,
    );
    try {
      this.speech.stop();
    } catch {
      this.#fail("Dictation could not finish. Check the words it captured.");
    }
  }

  /**
   * Leaving the pane or losing the connection keeps the words captured so far, never sending
   * them; `reason` explains an ending the user did not choose.
   */
  suspend(reason: string | null = null): void {
    if (this.#closed || this.state.phase === "idle") return;
    this.#action = "insert";
    this.#finish(reason);
  }

  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#timer);
    this.speech.onresult = this.speech.onerror = this.speech.onend = null;
    try {
      this.speech.abort();
    } catch {
      // Some engines throw if capture already ended.
    }
  }

  #finish(error: string | null = null): void {
    const text = this.state.transcript;
    this.dispose();
    this.#update({ phase: "idle", error });
    this.callbacks.finish(text, error || !text.trim() ? "insert" : this.#action);
  }
  #fail(error: string): void {
    this.#action = "insert";
    this.#finish(error);
  }
  #update(change: Partial<DictationState>): void {
    this.state = { ...this.state, ...change };
    this.callbacks.change(this.state);
  }
}
