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
  it("waits for final words and sends exactly once despite repeated Enter", () => {
    const { speech, callbacks, session, result } = recording();
    result(["Fix the", true], ["old", false]);
    session.stop("send");
    session.stop("send");
    expect(callbacks.finish).not.toHaveBeenCalled();
    result(["Fix the", true], ["old login bug.", true]);
    const end = speech.onend;
    end?.();
    end?.();
    expect(speech.stop).toHaveBeenCalledTimes(1);
    expect(callbacks.finish).toHaveBeenCalledExactlyOnceWith("Fix the old login bug.", "send");
  });
  it("stop reviews, while edit returns the complete text without sending", () => {
    const { session, speech, callbacks, result } = recording();
    result(["First sentence.", true]);
    session.stop("review");
    speech.onend?.();
    expect(session.state.phase).toBe("review");
    expect(callbacks.finish).not.toHaveBeenCalled();
    session.stop("edit");
    expect(callbacks.finish).toHaveBeenCalledExactlyOnceWith("First sentence.", "edit");
  });
  it("natural recognition completion never sends automatically", () => {
    const { speech, session, callbacks, result } = recording();
    result(["Keep this draft", true]);
    speech.onend?.();
    expect(session.state.phase).toBe("review");
    expect(callbacks.finish).not.toHaveBeenCalled();
  });
  it("cancel/unmount ignores late results, errors and completion", () => {
    const { speech, session, callbacks, result } = recording();
    result(["Keep this draft", false]);
    session.stop("send");
    const { onend, onresult, onerror } = speech;
    session.dispose();
    onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "stale" } }] });
    onerror?.({ error: "network" });
    onend?.();
    expect(callbacks.finish).not.toHaveBeenCalled();
    expect(callbacks.transcript).toHaveBeenCalledExactlyOnceWith("Keep this draft");
    expect(speech.abort).toHaveBeenCalledOnce();
  });
  it("disconnecting during Send keeps text for editing and cannot send later", () => {
    const { speech, session, callbacks, result } = recording();
    result(["Please wait", false]);
    session.stop("send");
    const end = speech.onend;
    session.suspend();
    end?.();
    expect(callbacks.finish).toHaveBeenCalledExactlyOnceWith("Please wait", "edit");
  });
  it.each(["network", "not-allowed", "no-speech"])(
    "%s errors preserve words and cancel pending Send",
    (error) => {
      const { speech, session, callbacks, result } = recording();
      result(["Recovered words", false]);
      session.stop("send");
      const end = speech.onend;
      speech.onerror?.({ error });
      end?.();
      expect(session.state).toMatchObject({ phase: "review", transcript: "Recovered words" });
      expect(session.state.error).toBeTruthy();
      expect(callbacks.finish).not.toHaveBeenCalled();
    },
  );
  it("a stalled service times out into review and ignores late finalization", () => {
    vi.useFakeTimers();
    const { speech, session, callbacks, result } = recording();
    result(["Recovered words", false]);
    session.stop("send");
    const end = speech.onend;
    vi.advanceTimersByTime(5000);
    end?.();
    expect(session.state.phase).toBe("review");
    expect(callbacks.finish).not.toHaveBeenCalled();
    expect(speech.abort).toHaveBeenCalledOnce();
  });
  it("empty dictation never sends an existing draft or attachments", () => {
    const { speech, session, callbacks } = recording();
    session.stop("send");
    speech.onend?.();
    expect(callbacks.finish).toHaveBeenCalledExactlyOnceWith("", "edit");
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
