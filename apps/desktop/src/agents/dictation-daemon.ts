import type { DaemonConnection } from "@concors/daemon-client";
import { DICTATION_SAMPLE_RATE, type DictationEvent } from "@concors/protocol";
import type { Recognition, SpeechEvent } from "./dictation-session";

export type DictationConnection = Pick<
  DaemonConnection,
  "requestDictation" | "sendDictationAudio" | "onDictation"
>;

/** Sends a quarter second at a time: responsive previews without a message per audio frame. */
const CHUNK_SAMPLES = DICTATION_SAMPLE_RATE / 4;

/** Averages each output sample's source window, which also filters what cannot be represented. */
export function resample(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === DICTATION_SAMPLE_RATE) return input;
  const ratio = fromRate / DICTATION_SAMPLE_RATE;
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j] ?? 0;
    output[i] = sum / (end - start);
  }
  return output;
}

/** 16-bit little-endian PCM as base64, the wire format of `dictation.audio`. */
export function encodePcm(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * The Web Speech `Recognition` shape, implemented by streaming the microphone to the daemon that
 * hosts the agent. `DictationSession` drives it exactly like a browser recognizer, so review,
 * Send, Edit and Cancel behave the same whichever engine transcribes.
 */
export class DaemonRecognition implements Recognition {
  continuous = true;
  interimResults = true;
  lang = "en";
  onresult: ((event: SpeechEvent) => void) | null = null;
  onerror: ((event: { error: string; message?: string }) => void) | null = null;
  onend: (() => void) | null = null;

  readonly #connection: DictationConnection;
  readonly #id = crypto.randomUUID();
  #seq = 0;
  #started = false;
  #ended = false;
  #buffer: Float32Array[] = [];
  #buffered = 0;
  #pending: string[] = [];
  #release: (() => void) | undefined;
  #unsubscribe: (() => void) | undefined;

  constructor(connection: DictationConnection) {
    this.#connection = connection;
  }

  start(): void {
    this.#unsubscribe = this.#connection.onDictation((event) => this.#event(event));
    this.#capture();
    this.#connection
      .requestDictation({ kind: "start", dictationId: this.#id }, crypto.randomUUID())
      .then((result) => {
        if (this.#ended) return;
        if (result.outcome.status === "error") return this.#error("daemon", result.outcome.message);
        this.#started = true;
        for (const pcm of this.#pending.splice(0)) this.#send(pcm);
      })
      .catch((error: unknown) =>
        this.#error("daemon", error instanceof Error ? error.message : undefined),
      );
  }

  /** Stops the microphone; the daemon transcribes what it has and sends the final text. */
  stop(): void {
    if (this.#ended) return;
    this.#stopCapture();
    this.#flush();
    const finish = () =>
      this.#connection
        .requestDictation({ kind: "finish", dictationId: this.#id }, crypto.randomUUID())
        .then((result) => {
          if (result.outcome.status === "error") this.#error("daemon", result.outcome.message);
        })
        .catch((error: unknown) =>
          this.#error("daemon", error instanceof Error ? error.message : undefined),
        );
    if (this.#started) void finish();
    else {
      // Audio captured before the daemon accepted the recording is still in flight.
      const waitForStart = setInterval(() => {
        if (this.#ended) clearInterval(waitForStart);
        else if (this.#started) {
          clearInterval(waitForStart);
          void finish();
        }
      }, 50);
    }
  }

  abort(): void {
    if (this.#ended) return;
    const started = this.#started;
    this.#end();
    if (started)
      void this.#connection
        .requestDictation({ kind: "cancel", dictationId: this.#id }, crypto.randomUUID())
        .catch(() => undefined);
  }

  #event(event: DictationEvent): void {
    if (this.#ended || !("dictationId" in event) || event.dictationId !== this.#id) return;
    if (event.type === "dictation.error") return this.#error("daemon", event.message);
    this.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: event.final, 0: { transcript: event.text } } },
    });
    if (event.final) {
      const end = this.onend;
      this.#end();
      end?.();
    }
  }

  #capture(): void {
    let closed = false;
    let context: AudioContext | undefined;
    let stream: MediaStream | undefined;
    this.#release = () => {
      closed = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") void context.close().catch(() => undefined);
    };
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext)
      return this.#error("audio-capture");
    navigator.mediaDevices
      .getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      .then((media) => {
        if (closed) return media.getTracks().forEach((track) => track.stop());
        stream = media;
        context = new AudioContext();
        const audio = context;
        void audio.resume().catch(() => undefined);
        const source = audio.createMediaStreamSource(media);
        // ScriptProcessor is deprecated but, unlike AudioWorklet, needs no module URL and runs in
        // every webview we ship (WebKitGTK, WKWebView, WebView2).
        const processor = audio.createScriptProcessor(4096, 1, 1);
        const mute = audio.createGain();
        mute.gain.value = 0;
        processor.onaudioprocess = (event) => {
          if (closed) return;
          this.#push(resample(event.inputBuffer.getChannelData(0).slice(), audio.sampleRate));
        };
        source.connect(processor);
        processor.connect(mute);
        mute.connect(audio.destination);
      })
      .catch((error: unknown) =>
        this.#error(
          error instanceof DOMException &&
            (error.name === "NotAllowedError" || error.name === "SecurityError")
            ? "not-allowed"
            : "audio-capture",
        ),
      );
  }

  #push(samples: Float32Array): void {
    this.#buffer.push(samples);
    this.#buffered += samples.length;
    if (this.#buffered >= CHUNK_SAMPLES) this.#flush();
  }

  #flush(): void {
    if (!this.#buffered) return;
    const joined = new Float32Array(this.#buffered);
    let offset = 0;
    for (const part of this.#buffer) {
      joined.set(part, offset);
      offset += part.length;
    }
    this.#buffer = [];
    this.#buffered = 0;
    // The protocol caps a chunk at one second.
    for (let i = 0; i < joined.length; i += DICTATION_SAMPLE_RATE) {
      const pcm = encodePcm(joined.subarray(i, i + DICTATION_SAMPLE_RATE));
      if (this.#started) this.#send(pcm);
      else this.#pending.push(pcm);
    }
  }

  #send(pcm: string): void {
    try {
      this.#connection.sendDictationAudio(this.#id, this.#seq++, pcm);
    } catch (error) {
      this.#error("daemon", error instanceof Error ? error.message : undefined);
    }
  }

  #stopCapture(): void {
    this.#release?.();
    this.#release = undefined;
  }

  #error(error: string, message?: string): void {
    if (this.#ended) return;
    const handler = this.onerror;
    this.abort();
    handler?.(message ? { error, message } : { error });
  }

  #end(): void {
    this.#ended = true;
    this.#stopCapture();
    this.#unsubscribe?.();
    this.#pending = [];
    this.#buffer = [];
  }
}
