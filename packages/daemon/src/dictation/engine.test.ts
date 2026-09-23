import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { expect, it } from "vitest";
import { ParakeetTranscriber } from "./engine.ts";

const files = { encoder: "e", decoder: "d", joiner: "j", tokens: "t" };

/** A worker that answers each utterance with its length, or dies when asked to. */
function fakeWorker(spawned: EventEmitter[]) {
  return () => {
    const worker = Object.assign(new EventEmitter(), {
      kill: () => worker.emit("exit", null, "SIGTERM"),
      send: (message: { id: number; samples: Float32Array }, done: (e: Error | null) => void) => {
        done(null);
        if (message.samples.length === 0) queueMicrotask(() => worker.emit("exit", 1, null));
        else
          queueMicrotask(() =>
            worker.emit("message", { id: message.id, text: `n${message.samples.length}` }),
          );
        return true;
      },
    });
    spawned.push(worker);
    return worker as unknown as ChildProcess;
  };
}

it("routes replies to their utterances through one worker", async () => {
  const spawned: EventEmitter[] = [];
  const transcriber = new ParakeetTranscriber(files, fakeWorker(spawned));
  await expect(
    Promise.all([
      transcriber.transcribe(new Float32Array(3)),
      transcriber.transcribe(new Float32Array(5)),
    ]),
  ).resolves.toEqual(["n3", "n5"]);
  expect(spawned).toHaveLength(1);
  transcriber.close();
});

it("fails in-flight work when the worker dies and starts a fresh one next time", async () => {
  const spawned: EventEmitter[] = [];
  const transcriber = new ParakeetTranscriber(files, fakeWorker(spawned));
  await expect(transcriber.transcribe(new Float32Array(0))).rejects.toThrow("speech worker");
  await expect(transcriber.transcribe(new Float32Array(2))).resolves.toBe("n2");
  expect(spawned).toHaveLength(2);
  transcriber.close();
});
