import type {
  DictationAudio,
  DictationEvent,
  DictationModel,
  DictationRequest,
  DictationResult,
} from "@concors/protocol";
import { ParakeetTranscriber, type Transcriber } from "./engine.ts";
import { ModelStore } from "./model.ts";
import { DictationStream } from "./stream.ts";

/** Enough for a few people dictating into one machine; each recording buffers its audio. */
const MAX_STREAMS = 8;
/** Lets the daemon finish starting before a large download competes for the network. */
const DOWNLOAD_DELAY_MS = 15_000;

export interface DictationServiceOptions {
  readonly models?: ModelStore;
  readonly transcriber?: (models: ModelStore) => Transcriber;
  readonly downloadDelayMs?: number;
}

/**
 * Dictation for every connection to this daemon. The model downloads in the background soon
 * after start, so dictation works without setup; recordings belong to the connection that
 * started them and end when it closes.
 */
export class DictationService {
  readonly #models: ModelStore;
  readonly #createTranscriber: (models: ModelStore) => Transcriber;
  readonly #downloadDelayMs: number;
  readonly #streams = new Map<string, { owner: string; stream: DictationStream }>();
  #transcriber: Transcriber | undefined;
  #download: ReturnType<typeof setTimeout> | undefined;
  #closed = false;

  constructor(root: string, options: DictationServiceOptions = {}) {
    this.#models = options.models ?? new ModelStore(root);
    this.#createTranscriber =
      options.transcriber ??
      ((models) =>
        new ParakeetTranscriber({
          encoder: models.path("encoder.int8.onnx"),
          decoder: models.path("decoder.int8.onnx"),
          joiner: models.path("joiner.int8.onnx"),
          tokens: models.path("tokens.txt"),
        }));
    this.#downloadDelayMs = options.downloadDelayMs ?? DOWNLOAD_DELAY_MS;
  }

  get model(): DictationModel {
    return this.#models.state;
  }

  onModel(listener: (model: DictationModel) => void): () => void {
    return this.#models.onChange(listener);
  }

  start(): void {
    void this.#models.check().then((ready) => {
      if (ready || this.#closed) return;
      this.#download = setTimeout(() => void this.#models.ensure(), this.#downloadDelayMs);
      this.#download.unref?.();
    });
  }

  request(
    owner: string,
    message: DictationRequest,
    emit: (event: DictationEvent) => void,
  ): DictationResult {
    const { requestId, operation } = message;
    const ok = (): DictationResult => ({
      type: "dictation.result",
      requestId,
      outcome: { status: "ok", model: this.model },
    });
    const error = (text: string): DictationResult => ({
      type: "dictation.result",
      requestId,
      outcome: { status: "error", message: text },
    });
    switch (operation.kind) {
      case "status":
        return ok();
      case "prepare":
        clearTimeout(this.#download);
        void this.#models.ensure();
        return ok();
      case "start": {
        const model = this.model;
        if (model.state !== "ready") {
          clearTimeout(this.#download);
          void this.#models.ensure();
          return error(notReady(model));
        }
        if (this.#streams.has(operation.dictationId)) return error("Dictation already started.");
        if (this.#streams.size >= MAX_STREAMS)
          return error("This machine is busy transcribing other dictations. Try again shortly.");
        this.#transcriber ??= this.#createTranscriber(this.#models);
        const stream = new DictationStream(operation.dictationId, this.#transcriber, (event) => {
          if (
            event.type === "dictation.error" ||
            (event.type === "dictation.transcript" && event.final)
          )
            this.#streams.delete(operation.dictationId);
          emit(event);
        });
        this.#streams.set(operation.dictationId, { owner, stream });
        return ok();
      }
      case "finish": {
        const entry = this.#own(owner, operation.dictationId);
        if (!entry) return error("This dictation has already ended.");
        void entry.stream.finish();
        return ok();
      }
      case "cancel": {
        const entry = this.#own(owner, operation.dictationId);
        entry?.stream.cancel();
        this.#streams.delete(operation.dictationId);
        return ok();
      }
    }
  }

  audio(owner: string, message: DictationAudio): void {
    this.#own(owner, message.dictationId)?.stream.append(
      message.seq,
      Buffer.from(message.pcm, "base64"),
    );
  }

  /** A closed connection cannot receive its transcript, so its recordings stop. */
  detach(owner: string): void {
    for (const [id, entry] of this.#streams)
      if (entry.owner === owner) {
        entry.stream.cancel();
        this.#streams.delete(id);
      }
  }

  close(): void {
    this.#closed = true;
    clearTimeout(this.#download);
    for (const { stream } of this.#streams.values()) stream.cancel();
    this.#streams.clear();
    this.#models.close();
    this.#transcriber?.close();
  }

  #own(owner: string, id: string) {
    const entry = this.#streams.get(id);
    return entry?.owner === owner ? entry : undefined;
  }
}

function notReady(model: DictationModel): string {
  if (model.state === "downloading")
    return `Dictation is getting ready on this machine: downloading its speech model (${Math.floor(
      (model.receivedBytes / model.totalBytes) * 100,
    )}%).`;
  if (model.state === "failed") return model.message;
  return "Dictation is getting ready on this machine: downloading its speech model.";
}
