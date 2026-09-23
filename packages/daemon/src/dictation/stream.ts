import {
  DICTATION_MAX_SECONDS,
  DICTATION_SAMPLE_RATE,
  type DictationEvent,
} from "@concors/protocol";
import type { Transcriber } from "./engine.ts";

const FRAME = DICTATION_SAMPLE_RATE * 0.03;
/** Frame RMS below this (of 32768) is a pause; above it, someone is talking. */
const SILENT_RMS = 250;
/** A whole utterance quieter than this is room noise, which the model turns into stray words. */
const SPEECH_PEAK = 300;
const PAUSE_SAMPLES = DICTATION_SAMPLE_RATE * 0.7;
const MIN_SEGMENT = DICTATION_SAMPLE_RATE * 1;
/** Parakeet is trained on short utterances; unbroken speech is cut at its quietest recent point. */
const MAX_SEGMENT = DICTATION_SAMPLE_RATE * 25;
const LOOKBACK = DICTATION_SAMPLE_RATE * 3;
const PARTIAL_EVERY = DICTATION_SAMPLE_RATE * 1;
const MAX_TEXT = 16_000;

function frameRms(samples: Int16Array, start: number): number {
  const end = Math.min(samples.length, start + FRAME);
  let sum = 0;
  for (let i = start; i < end; i++) sum += (samples[i] ?? 0) ** 2;
  return Math.sqrt(sum / Math.max(1, end - start));
}

export function peak(samples: Int16Array): number {
  let max = 0;
  for (const sample of samples) max = Math.max(max, Math.abs(sample));
  return max;
}

/**
 * Where to end the current utterance, or null to keep listening: in the middle of the first
 * long pause after speech, or — for a monologue without pauses — at the quietest frame of the
 * last few seconds once the utterance grows too long for the model.
 */
export function findCut(samples: Int16Array): number | null {
  let spoke = false;
  let silentSince = -1;
  for (let start = 0; start + FRAME <= samples.length; start += FRAME) {
    if (frameRms(samples, start) >= SILENT_RMS) {
      spoke = true;
      silentSince = -1;
    } else if (spoke) {
      if (silentSince < 0) silentSince = start;
      if (start + FRAME - silentSince >= PAUSE_SAMPLES && start >= MIN_SEGMENT)
        return silentSince + Math.floor(PAUSE_SAMPLES / 2);
    }
  }
  if (samples.length < MAX_SEGMENT) return null;
  let quietest = MAX_SEGMENT;
  let lowest = Infinity;
  for (let start = MAX_SEGMENT - LOOKBACK; start + FRAME <= MAX_SEGMENT; start += FRAME) {
    const rms = frameRms(samples, start);
    if (rms < lowest) [lowest, quietest] = [rms, start + FRAME];
  }
  return quietest;
}

/** Converts to the model's float input, raising quiet microphones to a usable level. */
export function toModelInput(samples: Int16Array): Float32Array {
  const loudest = peak(samples) / 32768;
  const gain = loudest > 0 && loudest < 0.6 ? Math.min(50, 0.6 / loudest) : 1;
  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++)
    output[i] = Math.max(-1, Math.min(1, ((samples[i] ?? 0) / 32768) * gain));
  return output;
}

export function joinTranscript(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, MAX_TEXT);
}

/**
 * One recording. Audio arrives in order; each finished utterance is transcribed exactly once,
 * in order, and the unfinished one is re-transcribed as a preview whenever the engine is idle.
 * After `final` or `error` nothing more is emitted, including from decodes still in flight.
 */
export class DictationStream {
  readonly id: string;
  readonly #transcriber: Transcriber;
  readonly #emit: (event: DictationEvent) => void;
  readonly #texts: string[] = [];
  #open = new Int16Array(0);
  #received = 0;
  #nextSeq = 0;
  #queue: Promise<void> = Promise.resolve();
  #pending = 0;
  #commits = 0;
  #sincePartial = 0;
  #partial = "";
  #closed = false;

  constructor(id: string, transcriber: Transcriber, emit: (event: DictationEvent) => void) {
    this.id = id;
    this.#transcriber = transcriber;
    this.#emit = emit;
  }

  get closed(): boolean {
    return this.#closed;
  }

  append(seq: number, pcm: Buffer): void {
    if (this.#closed) return;
    if (seq !== this.#nextSeq)
      return this.#fail("Some dictation audio was lost. You can edit the words captured so far.");
    this.#nextSeq++;
    // Copied rather than viewed: pooled Buffers can start at an odd offset.
    const samples = new Int16Array(Math.floor(pcm.byteLength / 2));
    for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2);
    this.#received += samples.length;
    if (this.#received > DICTATION_MAX_SECONDS * DICTATION_SAMPLE_RATE)
      return this.#fail(
        `Dictation stops after ${DICTATION_MAX_SECONDS / 60} minutes. You can edit the words captured so far.`,
      );
    const open = new Int16Array(this.#open.length + samples.length);
    open.set(this.#open);
    open.set(samples, this.#open.length);
    this.#open = open;
    this.#sincePartial += samples.length;
    const cut = findCut(this.#open);
    if (cut !== null) {
      this.#commit(this.#open.slice(0, cut));
      this.#open = this.#open.slice(cut);
    } else if (this.#pending === 0 && this.#sincePartial >= PARTIAL_EVERY) this.#preview();
  }

  /** Transcribes what is left and emits the final text. */
  async finish(): Promise<void> {
    if (this.#closed) return;
    this.#commit(this.#open);
    this.#open = new Int16Array(0);
    await this.#queue;
    if (this.#closed) return;
    this.#closed = true;
    this.#emit({
      type: "dictation.transcript",
      dictationId: this.id,
      text: joinTranscript(this.#texts),
      final: true,
    });
  }

  cancel(): void {
    this.#closed = true;
  }

  #commit(samples: Int16Array): void {
    this.#commits++;
    this.#partial = "";
    const index = this.#texts.push("") - 1;
    if (peak(samples) < SPEECH_PEAK) return;
    this.#enqueue(async () => {
      this.#texts[index] = await this.#transcriber.transcribe(toModelInput(samples));
      this.#publish();
    });
  }

  #preview(): void {
    this.#sincePartial = 0;
    const samples = this.#open;
    if (peak(samples) < SPEECH_PEAK) return;
    const commits = this.#commits;
    this.#enqueue(async () => {
      const text = await this.#transcriber.transcribe(toModelInput(samples));
      // A commit since this started already covers these words, or will shortly.
      if (commits !== this.#commits) return;
      this.#partial = text;
      this.#publish();
    });
  }

  #enqueue(job: () => Promise<void>): void {
    this.#pending++;
    this.#queue = this.#queue
      .then(async () => {
        if (!this.#closed) await job();
      })
      .catch(() =>
        this.#fail("Dictation stopped unexpectedly. You can edit the words captured so far."),
      )
      .finally(() => this.#pending--);
  }

  #publish(): void {
    if (this.#closed) return;
    this.#emit({
      type: "dictation.transcript",
      dictationId: this.id,
      text: joinTranscript([...this.#texts, this.#partial]),
      final: false,
    });
  }

  #fail(message: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#emit({ type: "dictation.error", dictationId: this.id, message });
  }
}
