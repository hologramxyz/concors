import { afterEach, expect, it, vi } from "vitest";
import { microphoneLevel, observeMicrophone } from "./dictation-audio";

afterEach(() => {
  vi.unstubAllGlobals();
});
function microphone() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] };
  const disconnect = vi.fn();
  const connect = vi.fn();
  const close = vi.fn(async () => undefined);
  class Audio {
    state = "running";
    resume = vi.fn(async () => undefined);
    close = close;
    createMediaStreamSource = () => ({ connect, disconnect });
    createAnalyser = () => ({
      fftSize: 512,
      getFloatTimeDomainData: (data: Float32Array) => data.fill(0.1),
    });
  }
  let ready: (value: typeof stream) => void = () => undefined;
  const pending = new Promise<typeof stream>((resolve) => {
    ready = resolve;
  });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(() => pending) } });
  vi.stubGlobal("AudioContext", Audio);
  vi.stubGlobal("window", { AudioContext: Audio });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 7),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return { stop, close, disconnect, connect, ready: () => ready(stream), pending };
}
it("shows actual loudness from silent, quiet and loud samples", () => {
  expect(microphoneLevel(new Float32Array(16))).toBe(0);
  expect(microphoneLevel(new Float32Array())).toBe(0);
  expect(microphoneLevel(new Float32Array([0.01, -0.01]))).toBeCloseTo(1 / 3);
  expect(microphoneLevel(new Float32Array([0.1, -0.1]))).toBeCloseTo(2 / 3);
  expect(microphoneLevel(new Float32Array([2, -2]))).toBe(1);
});
it("stops a microphone permission request that resolves after cancellation", async () => {
  const mic = microphone();
  const level = vi.fn(),
    unavailable = vi.fn();
  const dispose = observeMicrophone(level, unavailable);
  dispose();
  dispose();
  mic.ready();
  await mic.pending;
  expect(mic.stop).toHaveBeenCalledOnce();
  expect(mic.close).toHaveBeenCalledOnce();
  expect(mic.connect).not.toHaveBeenCalled();
  expect(level).not.toHaveBeenCalled();
  expect(unavailable).not.toHaveBeenCalled();
});
it("samples at most 20 times a second and releases every capture resource", async () => {
  const mic = microphone();
  const level = vi.fn();
  const dispose = observeMicrophone(level, vi.fn());
  mic.ready();
  await mic.pending;
  const frame = vi.mocked(requestAnimationFrame).mock.calls[0]![0];
  frame(0);
  frame(16);
  frame(32);
  frame(50);
  expect(level).toHaveBeenCalledTimes(2);
  expect(level.mock.calls[0]![0]).toBeCloseTo(2 / 3);
  dispose();
  frame(100);
  expect(level).toHaveBeenCalledTimes(2);
  expect(mic.stop).toHaveBeenCalledOnce();
  expect(mic.disconnect).toHaveBeenCalledOnce();
  expect(mic.close).toHaveBeenCalledOnce();
  expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
});
it("reports unavailable metering when capture is denied and closes the audio context", async () => {
  const mic = microphone();
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: () => Promise.reject(new Error("denied")) },
  });
  const unavailable = vi.fn();
  const dispose = observeMicrophone(vi.fn(), unavailable);
  await Promise.resolve();
  await Promise.resolve();
  expect(unavailable).toHaveBeenCalledOnce();
  expect(mic.close).toHaveBeenCalledOnce();
  dispose();
  expect(mic.close).toHaveBeenCalledOnce();
});
