import type { DictationEvent } from "@concors/protocol";
import { expect, it } from "vitest";
import type { Transcriber } from "./engine.ts";
import { DictationStream, findCut, joinTranscript, toModelInput } from "./stream.ts";

const RATE = 16_000;
const tone = (seconds: number, amplitude = 8000) =>
  Int16Array.from({ length: seconds * RATE }, (_, i) =>
    Math.round(amplitude * Math.sin((i / RATE) * 2 * Math.PI * 220)),
  );
const silence = (seconds: number) => new Int16Array(seconds * RATE);
const concat = (...parts: Int16Array[]) => {
  const out = new Int16Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
const pcm = (samples: Int16Array) => {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => buffer.writeInt16LE(sample, i * 2));
  return buffer;
};

/** Names each utterance by its length, so tests can see which audio reached the model. */
function transcriber(calls: number[] = []): Transcriber {
  return {
    async transcribe(samples) {
      calls.push(samples.length);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return `words${(samples.length / RATE).toFixed(1)}`;
    },
    close: () => undefined,
  };
}

it("ends an utterance in the middle of a pause after speech", () => {
  expect(findCut(concat(silence(1), tone(2)))).toBeNull();
  const cut = findCut(concat(tone(2), silence(1), tone(1)));
  expect(cut).toBeGreaterThan(2 * RATE);
  expect(cut).toBeLessThan(3 * RATE);
  // A short breath is not a pause.
  expect(findCut(concat(tone(2), silence(0.3), tone(1)))).toBeNull();
});

it("cuts unbroken speech before the model's length limit", () => {
  const cut = findCut(concat(tone(23), silence(0.1), tone(4)));
  expect(cut).toBeGreaterThan(22 * RATE);
  expect(cut).toBeLessThanOrEqual(25 * RATE);
});

it("raises quiet audio but never clips", () => {
  const quiet = toModelInput(Int16Array.from([0, 1000, -1000]));
  expect(quiet[1]).toBeCloseTo(0.6);
  const loud = toModelInput(Int16Array.from([32767, -32768]));
  expect(Math.max(...loud)).toBeLessThanOrEqual(1);
  expect(joinTranscript([" a ", "", "b"])).toBe("a b");
});

it("transcribes each utterance once and in order, then sends one final transcript", async () => {
  const events: DictationEvent[] = [];
  const calls: number[] = [];
  const stream = new DictationStream("id", transcriber(calls), (event) => events.push(event));
  const audio = concat(tone(2), silence(1), tone(1.5));
  for (let i = 0, seq = 0; i < audio.length; i += RATE / 4, seq++)
    stream.append(seq, pcm(audio.subarray(i, i + RATE / 4)));
  await stream.finish();
  const final = events.at(-1);
  expect(final).toMatchObject({ type: "dictation.transcript", final: true });
  expect(final?.type === "dictation.transcript" && final.text.split(" ")).toHaveLength(2);
  expect(
    events.filter((event) => event.type === "dictation.transcript" && event.final),
  ).toHaveLength(1);
  stream.append(99, pcm(tone(1)));
  await stream.finish();
  expect(events.at(-1)).toBe(final);
});

it("skips silent recordings instead of inventing words", async () => {
  const events: DictationEvent[] = [];
  const calls: number[] = [];
  const stream = new DictationStream("id", transcriber(calls), (event) => events.push(event));
  stream.append(0, pcm(silence(3)));
  await stream.finish();
  expect(calls).toEqual([]);
  expect(events).toEqual([
    { type: "dictation.transcript", dictationId: "id", text: "", final: true },
  ]);
});

it("stops on lost audio and emits nothing after cancel", async () => {
  const events: DictationEvent[] = [];
  const stream = new DictationStream("id", transcriber(), (event) => events.push(event));
  stream.append(0, pcm(tone(0.5)));
  stream.append(2, pcm(tone(0.5)));
  expect(events).toEqual([expect.objectContaining({ type: "dictation.error" })]);

  const quiet: DictationEvent[] = [];
  const canceled = new DictationStream("id2", transcriber(), (event) => quiet.push(event));
  canceled.append(0, pcm(concat(tone(2), silence(1))));
  canceled.cancel();
  await canceled.finish();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(quiet).toEqual([]);
});

it("reports a transcription failure once and keeps earlier words client-side", async () => {
  const events: DictationEvent[] = [];
  const stream = new DictationStream(
    "id",
    {
      transcribe: () => Promise.reject(new Error("onnx")),
      close: () => undefined,
    },
    (event) => events.push(event),
  );
  stream.append(0, pcm(concat(tone(2), silence(1))));
  await stream.finish();
  expect(events).toEqual([expect.objectContaining({ type: "dictation.error" })]);
});
