import { spawn, type ChildProcess } from "node:child_process";
import { createRequire as requireFrom } from "node:module";
import { availableParallelism } from "node:os";
import { isSea } from "node:sea";
import { DICTATION_SAMPLE_RATE } from "@concors/protocol";

/** The subset of sherpa-onnx-node the daemon uses. */
interface OfflineStream {
  acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void;
}
interface OfflineRecognizer {
  createStream(): OfflineStream;
  decodeAsync(stream: OfflineStream): Promise<{ text?: string }>;
}
interface Sherpa {
  OfflineRecognizer: { createAsync(config: unknown): Promise<OfflineRecognizer> };
}

export interface Transcriber {
  /** Transcribes one utterance of 16 kHz mono samples in [-1, 1]. */
  transcribe(samples: Float32Array): Promise<string>;
  close(): void;
}

export interface ModelFiles {
  readonly encoder: string;
  readonly decoder: string;
  readonly joiner: string;
  readonly tokens: string;
}

interface WorkerRequest {
  readonly id: number;
  readonly files: ModelFiles;
  readonly samples: Float32Array;
}
type WorkerReply = { id: number; text: string } | { id: number; error: string };

const IDLE_EXIT_MS = 10 * 60_000;

/**
 * Loads sherpa-onnx from the daemon's own node_modules at runtime. The package is copied beside
 * the bundle with its platform library (like the PTY module), because esbuild cannot inline a
 * native addon; calling a require that esbuild does not recognise keeps it out of the bundle.
 */
export function loadSherpa(): Sherpa {
  // Aliased: the bundle's banner already declares `createRequire` at module scope.
  const load = requireFrom(import.meta.url);
  const name = "sherpa-onnx-node";
  return load(name) as Sherpa;
}

/** The `speech-worker` command: transcribes utterances sent over IPC until its parent leaves. */
export function runSpeechWorker(): Promise<void> {
  process.title = "concors-speech";
  let recognizer: Promise<OfflineRecognizer> | undefined;
  process.on("message", (message: WorkerRequest) => {
    void (async () => {
      try {
        recognizer ??= loadSherpa().OfflineRecognizer.createAsync({
          featConfig: { sampleRate: DICTATION_SAMPLE_RATE, featureDim: 80 },
          modelConfig: {
            transducer: {
              encoder: message.files.encoder,
              decoder: message.files.decoder,
              joiner: message.files.joiner,
            },
            tokens: message.files.tokens,
            modelType: "nemo_transducer",
            // Leave most cores to the agents and builds the machine exists for.
            numThreads: Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2))),
            provider: "cpu",
            debug: 0,
          },
          decodingMethod: "greedy_search",
        });
        const loaded = await recognizer;
        const stream = loaded.createStream();
        stream.acceptWaveform({ samples: message.samples, sampleRate: DICTATION_SAMPLE_RATE });
        const result = await loaded.decodeAsync(stream);
        process.send?.({ id: message.id, text: (result.text ?? "").trim() } satisfies WorkerReply);
      } catch (error) {
        recognizer = undefined;
        process.send?.({
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        } satisfies WorkerReply);
      }
    })();
  });
  return new Promise((resolve) => process.once("disconnect", resolve));
}

/** Runs this same daemon build as a speech worker. */
function spawnSpeechWorker(): ChildProcess {
  const args = [
    ...process.execArgv.filter((flag) => !flag.startsWith("--watch")),
    ...(isSea() || !process.argv[1] ? [] : [process.argv[1]]),
    "speech-worker",
  ];
  return spawn(process.execPath, args, {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    serialization: "advanced",
    windowsHide: true,
  });
}

/**
 * Parakeet through sherpa-onnx, in a child process. The recognizer holds over a gigabyte that
 * the addon never hands back, and a native fault must not take down the session host with every
 * agent and terminal in it; exiting the worker after a quiet period returns the memory for certain.
 */
export class ParakeetTranscriber implements Transcriber {
  readonly #files: ModelFiles;
  readonly #spawn: () => ChildProcess;
  readonly #pending = new Map<
    number,
    { resolve: (text: string) => void; reject: (error: Error) => void }
  >();
  #worker: ChildProcess | undefined;
  #next = 0;
  #idle: ReturnType<typeof setTimeout> | undefined;

  constructor(files: ModelFiles, spawnWorker: () => ChildProcess = spawnSpeechWorker) {
    this.#files = files;
    this.#spawn = spawnWorker;
  }

  transcribe(samples: Float32Array): Promise<string> {
    clearTimeout(this.#idle);
    const worker = (this.#worker ??= this.#start());
    const id = this.#next++;
    return new Promise<string>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      worker.send({ id, files: this.#files, samples } satisfies WorkerRequest, (error) => {
        if (error) this.#settle({ id, error: error.message });
      });
    });
  }

  close(): void {
    clearTimeout(this.#idle);
    this.#worker?.kill();
    this.#worker = undefined;
  }

  #start(): ChildProcess {
    const worker = this.#spawn();
    const stopped = () => {
      if (this.#worker === worker) this.#worker = undefined;
      for (const [id] of this.#pending) this.#settle({ id, error: "The speech worker stopped." });
    };
    worker.on("message", (reply: WorkerReply) => this.#settle(reply));
    worker.once("exit", stopped);
    worker.once("error", stopped);
    return worker;
  }

  #settle(reply: WorkerReply): void {
    const pending = this.#pending.get(reply.id);
    if (!pending) return;
    this.#pending.delete(reply.id);
    if ("error" in reply) pending.reject(new Error(reply.error));
    else pending.resolve(reply.text);
    if (this.#pending.size === 0) {
      this.#idle = setTimeout(() => this.close(), IDLE_EXIT_MS);
      this.#idle.unref?.();
    }
  }
}
