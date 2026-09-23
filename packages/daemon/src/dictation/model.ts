import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { DictationModel } from "@concors/protocol";

/**
 * NVIDIA Parakeet TDT 0.6B v2 (English), int8, exported for sherpa-onnx. CC-BY-4.0.
 * Pinned to one revision with the SHA-256 of every file, so a moved branch or a tampered mirror
 * fails verification instead of being loaded into the daemon.
 */
const REVISION = "1ab9323565ddb038682214b292f588070a538ce2";
const BASE = `https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/${REVISION}`;
export const PARAKEET_MODEL = {
  id: "parakeet-tdt-0.6b-v2-int8",
  files: [
    {
      name: "encoder.int8.onnx",
      bytes: 652_184_296,
      sha256: "a32b12d17bbbc309d0686fbbcc2987b5e9b8333a7da83fa6b089f0a2acd651ab",
    },
    {
      name: "decoder.int8.onnx",
      bytes: 7_257_753,
      sha256: "b6bb64963457237b900e496ee9994b59294526439fbcc1fecf705b31a15c6b4e",
    },
    {
      name: "joiner.int8.onnx",
      bytes: 1_739_080,
      sha256: "7946164367946e7f9f29a122407c3252b680dbae9a51343eb2488d057c3c43d2",
    },
    {
      name: "tokens.txt",
      bytes: 9_384,
      sha256: "ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d",
    },
  ],
} as const;
export interface ModelSpec {
  readonly id: string;
  readonly files: readonly { name: string; bytes: number; sha256: string }[];
}

/** Room for the model plus some slack, so the download never fills the disk agents work on. */
const FREE_SPACE_MARGIN = 512 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 500;
const RETRY_AFTER_MS = 5 * 60_000;

export interface ModelStoreOptions {
  readonly spec?: ModelSpec;
  readonly url?: (file: string) => string;
  readonly fetch?: typeof fetch;
  readonly retryAfterMs?: number;
}

/**
 * Owns the speech model on disk: whether it is present, the one download that fetches it, and
 * the state clients see. Files are verified while streaming and renamed into place only when
 * their hash matches; a `ready` marker is written last, so a crash mid-download is never
 * mistaken for a complete model.
 */
export class ModelStore {
  readonly directory: string;
  readonly #spec: ModelSpec;
  readonly #url: (file: string) => string;
  readonly #fetch: typeof fetch;
  readonly #retryAfterMs: number;
  readonly #listeners = new Set<(model: DictationModel) => void>();
  #state: DictationModel = { state: "missing" };
  #download: Promise<void> | undefined;
  #abort = new AbortController();
  #retry: ReturnType<typeof setTimeout> | undefined;
  #lastProgress = 0;

  constructor(root: string, options: ModelStoreOptions = {}) {
    this.#spec = options.spec ?? PARAKEET_MODEL;
    this.directory = join(root, this.#spec.id);
    this.#url = options.url ?? ((file) => `${BASE}/${file}`);
    this.#fetch = options.fetch ?? fetch;
    this.#retryAfterMs = options.retryAfterMs ?? RETRY_AFTER_MS;
  }

  get state(): DictationModel {
    return this.#state;
  }

  path(file: string): string {
    return join(this.directory, file);
  }

  onChange(listener: (model: DictationModel) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Marks an already-downloaded model ready without touching the network. */
  async check(): Promise<boolean> {
    if (this.#state.state === "missing" && (await this.#complete())) this.#set({ state: "ready" });
    return this.#state.state === "ready";
  }

  /** Resolves once the model is on disk, downloading it if needed. Never rejects. */
  ensure(): Promise<void> {
    if (this.#state.state === "ready") return Promise.resolve();
    clearTimeout(this.#retry);
    this.#download ??= this.#run().finally(() => {
      this.#download = undefined;
    });
    return this.#download;
  }

  close(): void {
    clearTimeout(this.#retry);
    this.#abort.abort();
  }

  async #run(): Promise<void> {
    if (await this.#complete()) return this.#set({ state: "ready" });
    const totalBytes = this.#spec.files.reduce((sum, file) => sum + file.bytes, 0);
    try {
      await mkdir(this.directory, { recursive: true });
      const { bavail, bsize } = await statfs(this.directory);
      if (bavail * bsize < totalBytes + FREE_SPACE_MARGIN)
        throw new Error(
          `Dictation needs ${Math.ceil((totalBytes + FREE_SPACE_MARGIN) / 1e9)} GB of free disk space for its speech model.`,
        );
      let receivedBytes = 0;
      this.#set({ state: "downloading", receivedBytes, totalBytes });
      for (const file of this.#spec.files) {
        const target = this.path(file.name);
        if (await matches(target, file)) {
          receivedBytes += file.bytes;
          continue;
        }
        const base = receivedBytes;
        await this.#fetchFile(file, target, (bytes) => {
          receivedBytes = base + bytes;
          const now = Date.now();
          if (now - this.#lastProgress < PROGRESS_INTERVAL_MS) return;
          this.#lastProgress = now;
          this.#set({ state: "downloading", receivedBytes, totalBytes });
        });
        receivedBytes = base + file.bytes;
      }
      await writeFile(this.path("ready"), `${this.#spec.id}\n`);
      this.#set({ state: "ready" });
    } catch (error) {
      if (this.#abort.signal.aborted) return;
      this.#set({
        state: "failed",
        message:
          `Could not download the speech model: ${error instanceof Error ? error.message : String(error)}`.slice(
            0,
            1000,
          ),
      });
      this.#retry = setTimeout(() => void this.ensure(), this.#retryAfterMs);
      this.#retry.unref?.();
    }
  }

  async #fetchFile(
    file: ModelSpec["files"][number],
    target: string,
    progress: (bytes: number) => void,
  ): Promise<void> {
    const partial = `${target}.partial`;
    await rm(partial, { force: true });
    const response = await this.#fetch(this.#url(file.name), { signal: this.#abort.signal });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${file.name}`);
    const hash = createHash("sha256");
    let bytes = 0;
    await pipeline(
      Readable.fromWeb(response.body as WebReadableStream),
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          bytes += chunk.length;
          if (bytes > file.bytes) return done(new Error(`${file.name} is larger than expected`));
          hash.update(chunk);
          progress(bytes);
          done(null, chunk);
        },
      }),
      createWriteStream(partial),
      { signal: this.#abort.signal },
    );
    if (bytes !== file.bytes || hash.digest("hex") !== file.sha256) {
      await rm(partial, { force: true });
      throw new Error(`${file.name} failed verification`);
    }
    await rename(partial, target);
  }

  async #complete(): Promise<boolean> {
    try {
      await stat(this.path("ready"));
    } catch {
      return false;
    }
    for (const file of this.#spec.files) {
      const info = await stat(this.path(file.name)).catch(() => null);
      if (info?.size !== file.bytes) return false;
    }
    return true;
  }

  #set(state: DictationModel): void {
    this.#state = state;
    for (const listener of this.#listeners) listener(state);
  }
}

/** A complete earlier download of the same file is reused rather than fetched again. */
async function matches(path: string, file: ModelSpec["files"][number]): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  if (info?.size !== file.bytes) return false;
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex") === file.sha256;
}
