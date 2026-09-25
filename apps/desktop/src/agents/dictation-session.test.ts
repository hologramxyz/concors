import { afterEach, describe, expect, it, vi } from "vitest";
import { appendDictation, DictationSession, type Recognition } from "./dictation-session";

function recording() {
  const speech: Recognition = {
    continuous: false,
    interimResults: false,
    lang: "",
    onresult: null,
    onerror: null,
    onend: null,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
  };
  const callbacks = { change: vi.fn(), transcript: vi.fn(), finish: vi.fn() };
  const session = new DictationSession(speech, callbacks);
  session.start("en-US");
  const result = (...segments: [string, boolean][]) =>
    speech.onresult?.({
      resultIndex: 0,
      results: segments.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })),
    });
  return { speech, callbacks, session, result };
}
afterEach(() => vi.useRealTimers());

describe("dictation completion", () => {
  it("waits for the final words and hands them to the prompt box exactly once", () => {
    const { speech, callbacks, session, result } = recording();
    result(["Fix the", true], ["old", false]);
    session.stop();
    session.stop();
    expect(callbacks.finish).not.toHaveBeenCalled();
    result(["Fix the", true], ["old login bug.", true]);
    const end = speech.onend;
    end?.();
    end?.();
    expect(speech.stop).toHaveBeenCalledTimes(1);
    expect(callbacks.finish).toHaveBeenCalledExactlyOnceWith("Fix the old login bug.");
    expect(session.state).toMatchObject({ phase: "idle", error: null });
  });
  it("puts the words in the prompt box when the service ends on its own", () => {
    const { speech, session, callbacks, result } = recording();
    result(["Keep this draft", true]);
    speech.onend?.();
    expect(session.state.phase).toBe("idle");
    expect(callbacks.finish).toHaveBeenCalledExactlyOnceWith("Keep this draft");
  });
  it("cancel/unmount ignores late results, errors and completion", () => {
    const { speech, session, callbacks, result } = recording();
    result(["Keep this draft", false]);
    session.stop();
    const { onend, onresult, onerror } = speech;
    session.dispose();
    onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "stale" } }] });
    onerror?.({ error: "network" });
    onend?.();
    expect(callbacks.finish).not.toHaveBeenCalled();
    expect(callbacks.transcript).toHaveBeenCalledExactlyOnceWith("Keep this draft");
    expect(speech.abort).toHaveBeenCalledOnce();
  });
  it("leaving the pane while finishing keeps the words once", () => {
    const { speech, session, callbacks, result } = recording();
    result(["Please wait", false]);
    session.stop();
    const end = speech.onend;
    session.suspend();
    end?.();
    expect(callbacks.finish).toHaveBeenCalledExactlyOnceWith("Please wait");
  });
  it.each(["network", "not-allowed", "no-speech"])(
    "%s errors keep the words captured so far and explain what happened",
    (error) => {
      const { speech, session, callbacks, result } = recording();
      result(["Recovered words", false]);
      session.stop();
      const end = speech.onend;
      speech.onerror?.({ error });
      end?.();
      expect(session.state.phase).toBe("idle");
      expect(session.state.error).toBeTruthy();
      expect(callbacks.finish).toHaveBeenCalledExactlyOnceWith("Recovered words");
    },
  );
  it("a stalled service times out, keeps the words and ignores late finalization", () => {
    vi.useFakeTimers();
    const { speech, session, callbacks, result } = recording();
    result(["Recovered words", false]);
    session.stop();
    const end = speech.onend;
    vi.advanceTimersByTime(5000);
    end?.();
    expect(session.state).toMatchObject({ phase: "idle" });
    expect(session.state.error).toBeTruthy();
    expect(callbacks.finish).toHaveBeenCalledExactlyOnceWith("Recovered words");
    expect(speech.abort).toHaveBeenCalledOnce();
  });
  it("empty dictation leaves the draft alone", () => {
    const { speech, session, callbacks } = recording();
    session.stop();
    speech.onend?.();
    expect(callbacks.finish).toHaveBeenCalledExactlyOnceWith("");
  });
  it("ignores queued result callbacks after permission denial", () => {
    const { speech, session, callbacks } = recording();
    const result = speech.onresult;
    speech.onerror?.({ error: "not-allowed" });
    result?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "late words" } }] });
    expect(session.state.phase).toBe("idle");
    expect(callbacks.transcript).not.toHaveBeenCalled();
  });
  it("appends to the original draft without breaking whitespace or the message limit", () => {
    expect(appendDictation("Original draft", "spoken words")).toBe("Original draft spoken words");
    expect(appendDictation("Original draft\n", "spoken words")).toBe(
      "Original draft\nspoken words",
    );
    expect(appendDictation("Original draft", "")).toBe("Original draft");
    expect(appendDictation("a".repeat(15999), "hello")).toHaveLength(16000);
  });
});
