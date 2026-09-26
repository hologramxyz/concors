import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DictationEvent, DictationOperation, DictationResult } from "@concors/protocol";
import {
  DaemonRecognition,
  encodePcm,
  resample,
  type DictationConnection,
} from "./dictation-daemon";
import { DictationSession } from "./dictation-session";

let processor: { onaudioprocess: ((event: unknown) => void) | null } | undefined;
const tracks = [{ stop: vi.fn() }];
class FakeAudioContext {
  sampleRate = 48_000;
  state = "running";
  destination = {};
  resume = () => Promise.resolve();
  close = vi.fn(() => {
    this.state = "closed";
    return Promise.resolve();
  });
  createMediaStreamSource = () => ({ connect: vi.fn() });
  createGain = () => ({ gain: { value: 1 }, connect: vi.fn() });
  createScriptProcessor = () => (processor = { onaudioprocess: null, connect: vi.fn() } as never);
}
/** Feeds the microphone one callback of 48 kHz audio. */
const speak = (samples: number) =>
  processor?.onaudioprocess?.({
    inputBuffer: { getChannelData: () => new Float32Array(samples).fill(0.25) },
  });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function daemon(start: DictationResult["outcome"] = { status: "ok", model: { state: "ready" } }) {
  const listeners = new Set<(event: DictationEvent) => void>();
  const operations: DictationOperation[] = [];
  const audio: { seq: number; bytes: number }[] = [];
  const connection: DictationConnection = {
    onDictation: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestDictation: async (operation, requestId) => {
      operations.push(operation);
      return {
        type: "dictation.result",
        requestId,
        outcome: operation.kind === "start" ? start : { status: "ok", model: { state: "ready" } },
      };
    },
    sendDictationAudio: (_id, seq, pcm) => audio.push({ seq, bytes: atob(pcm).length }),
  };
  const emit = (event: DictationEvent) => listeners.forEach((listener) => listener(event));
  const id = () => (operations[0] as { dictationId: string }).dictationId;
  return { connection, operations, audio, emit, id, listeners };
}

beforeEach(() => {
  processor = undefined;
  tracks[0]!.stop.mockClear();
  vi.stubGlobal("window", { AudioContext: FakeAudioContext });
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("navigator", {
    language: "en-US",
    mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => tracks }) },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("daemon dictation audio", () => {
  it("downsamples to 16 kHz by averaging and encodes little-endian PCM", () => {
    expect(Array.from(resample(Float32Array.from([0, 0.3, 0.6, 1, 1, 1]), 48_000))).toEqual([
      expect.closeTo(0.3),
      1,
    ]);
    expect(
      Array.from(atob(encodePcm(Float32Array.from([1, -1, 0, 2]))), (c) => c.charCodeAt(0)),
    ).toEqual([0xff, 0x7f, 0x00, 0x80, 0, 0, 0xff, 0x7f]);
  });
});

describe("DaemonRecognition", () => {
  it("streams audio in order, previews, and ends with the daemon's final transcript", async () => {
    const fake = daemon();
    const callbacks = { change: vi.fn(), transcript: vi.fn(), finish: vi.fn() };
    const session = new DictationSession(new DaemonRecognition(fake.connection), callbacks, 30_000);
    session.start("en-US");
    await flush();
    speak(4096);
    speak(4096);
    speak(4096);
    expect(fake.operations[0]).toMatchObject({ kind: "start" });
    expect(fake.audio.map((chunk) => chunk.seq)).toEqual([0]);
    fake.emit({
      type: "dictation.transcript",
      dictationId: fake.id(),
      text: "Fix the",
      final: false,
    });
    expect(callbacks.transcript).toHaveBeenLastCalledWith("Fix the");

    // Audio shorter than a chunk is still delivered when the recording stops.
    speak(4096);
    session.stop("send");
    await flush();
    expect(tracks[0]!.stop).toHaveBeenCalled();
    expect(fake.audio.map((chunk) => chunk.seq)).toEqual([0, 1]);
    expect(fake.audio.reduce((sum, chunk) => sum + chunk.bytes, 0)).toBe(4 * 1365 * 2);
    expect(fake.operations.at(-1)).toMatchObject({ kind: "finish" });
    fake.emit({
      type: "dictation.transcript",
      dictationId: fake.id(),
      text: "Fix the login bug.",
      final: true,
    });
    expect(callbacks.finish).toHaveBeenCalledExactlyOnceWith("Fix the login bug.", "send");
    expect(fake.listeners.size).toBe(0);
  });

  it("shows why the daemon cannot dictate yet and releases the microphone", async () => {
    const fake = daemon({ status: "error", message: "Dictation is getting ready (40%)." });
    const session = new DictationSession(new DaemonRecognition(fake.connection), {
      change: vi.fn(),
      transcript: vi.fn(),
      finish: vi.fn(),
    });
    session.start("en-US");
    await flush();
    expect(session.state).toMatchObject({
      phase: "idle",
      error: "Dictation is getting ready (40%).",
    });
    expect(tracks[0]!.stop).toHaveBeenCalled();
    expect(fake.listeners.size).toBe(0);
  });

  it("maps a denied microphone to the permission message and cancels the recording", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
      },
    });
    const fake = daemon();
    const session = new DictationSession(new DaemonRecognition(fake.connection), {
      change: vi.fn(),
      transcript: vi.fn(),
      finish: vi.fn(),
    });
    session.start("en-US");
    await flush();
    await flush();
    expect(session.state.error).toBe("Allow microphone access to use dictation.");
    expect(fake.operations.map((operation) => operation.kind)).toEqual(["start", "cancel"]);
  });

  it("ignores other recordings and stops listening once canceled", async () => {
    const fake = daemon();
    const callbacks = { change: vi.fn(), transcript: vi.fn(), finish: vi.fn() };
    const session = new DictationSession(new DaemonRecognition(fake.connection), callbacks);
    session.start("en-US");
    await flush();
    fake.emit({
      type: "dictation.transcript",
      dictationId: crypto.randomUUID(),
      text: "someone else",
      final: true,
    });
    expect(callbacks.transcript).not.toHaveBeenCalled();
    session.dispose();
    await flush();
    expect(fake.operations.at(-1)).toMatchObject({ kind: "cancel" });
    expect(fake.listeners.size).toBe(0);
  });
});
