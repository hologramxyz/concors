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
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type DictationAction = "review" | "edit" | "send";
export interface DictationState {
  phase: "idle" | "recording" | "stopping" | "review";
  transcript: string;
  error: string | null;
}
export const emptyDictation: DictationState = { phase: "idle", transcript: "", error: null };
interface DictationCallbacks {
  change: (state: DictationState) => void;
  transcript: (text: string) => void;
  finish: (text: string, action: "edit" | "send") => void;
}

export function appendDictation(draft: string, transcript: string): string {
  return (draft + (draft && transcript && !/\s$/.test(draft) ? " " : "") + transcript).slice(
    0,
    16000,
  );
}

/** One recognition run owns its final results and exactly one explicit completion intent. */
export class DictationSession {
  state: DictationState = { ...emptyDictation, phase: "recording" };
  #action: DictationAction = "review";
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;
  private speech: Recognition;
  private callbacks: DictationCallbacks;
  constructor(speech: Recognition, callbacks: DictationCallbacks) {
    this.speech = speech;
    this.callbacks = callbacks;
  }

  start(language: string): void {
    this.speech.continuous = true;
    this.speech.interimResults = true;
    this.speech.lang = language;
    this.speech.onresult = (event) => {
      if (this.#closed || this.state.phase === "review") return;
      // Rebuild the whole result list so revised interim words are replaced, not duplicated.
      const transcript = Array.from(event.results, (result) => result[0].transcript.trim())
        .filter(Boolean)
        .join(" ")
        .slice(0, 16000);
      this.callbacks.transcript(transcript);
      this.#update({ transcript });
    };
    this.speech.onerror = ({ error }) => {
      if (this.#closed) return;
      const message =
        error === "not-allowed" || error === "service-not-allowed"
          ? "Allow microphone access to use dictation."
          : error === "no-speech"
            ? "No speech was detected. Try again or type your message."
            : "Dictation stopped unexpectedly. You can edit the words captured so far.";
      this.#fail(message);
    };
    this.speech.onend = () => {
      if (this.#closed) return;
      clearTimeout(this.#timer);
      if (this.#action === "review") this.#review();
      else this.#finish(this.#action);
    };
    this.#update({});
    try {
      this.speech.start();
    } catch {
      this.#fail("Could not start dictation. Check microphone access and try again.");
    }
  }

  stop(action: DictationAction): void {
    if (this.#closed || this.state.phase === "stopping" || this.state.phase === "idle") return;
    if (this.state.phase === "review") {
      if (action !== "review") this.#finish(action);
      return;
    }
    this.#action = action;
    this.#update({ phase: "stopping" });
    // Never send an uncertain transcript on recognition failure or timeout.
    this.#timer = setTimeout(
      () => this.#fail("Dictation could not finish. Review the captured text before sending."),
      5000,
    );
    try {
      this.speech.stop();
    } catch {
      this.#fail("Dictation could not finish. Review the captured text before sending.");
    }
  }

  /** Leaving the pane/disconnecting cancels a pending Send, preserving the editable draft. */
  suspend(): void {
    if (!this.#closed && this.state.phase !== "idle") this.#finish("edit");
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

  #finish(action: "edit" | "send"): void {
    const text = this.state.transcript;
    this.dispose();
    this.#update({ phase: "idle" });
    this.callbacks.finish(text, text.trim() ? action : "edit");
  }
  #review(): void {
    this.speech.onresult = this.speech.onerror = this.speech.onend = null;
    this.#update({ phase: this.state.transcript ? "review" : "idle" });
  }
  #fail(error: string): void {
    clearTimeout(this.#timer);
    this.#action = "review";
    this.speech.onresult = this.speech.onerror = this.speech.onend = null;
    try {
      this.speech.abort();
    } catch {
      // The service may already have stopped.
    }
    this.#update({ error });
    this.#review();
  }
  #update(change: Partial<DictationState>): void {
    this.state = { ...this.state, ...change };
    this.callbacks.change(this.state);
  }
}
