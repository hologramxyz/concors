import { describe, expect, it, vi } from "vitest";
import { clipboardAction, terminalClipboardHandler } from "./clipboard";

function key(overrides: Partial<KeyboardEvent> = {}) {
  return {
    key: "c",
    type: "keydown",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    repeat: false,
    getModifierState: () => false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

function fixture() {
  const terminal = { getSelection: vi.fn(() => "selected output"), paste: vi.fn() };
  const read = vi.fn(async () => "one\ntwo");
  const write = vi.fn(async (_text: string) => undefined);
  const canPaste = vi.fn(() => true);
  const report = vi.fn();
  return {
    terminal,
    read,
    write,
    canPaste,
    report,
    handle: terminalClipboardHandler({ terminal, read, write, canPaste, report }),
  };
}

describe("terminal clipboard shortcuts", () => {
  it.each(["c", "C", "v", "V"])("supports Super and Ctrl+Shift with %s", (letter) => {
    const expected = letter.toLowerCase() === "c" ? "copy" : "paste";
    expect(clipboardAction(key({ key: letter, metaKey: true }))).toBe(expected);
    expect(clipboardAction(key({ key: letter, ctrlKey: true, shiftKey: true }))).toBe(expected);
  });

  it("leaves shell controls, other shortcuts, AltGr and composition alone", () => {
    const f = fixture();
    for (const event of [
      key({ ctrlKey: true }),
      key({ key: "v", ctrlKey: true }),
      key({ metaKey: true, altKey: true }),
      key({ metaKey: true, ctrlKey: true }),
      key({ metaKey: true, isComposing: true }),
      key({ metaKey: true, getModifierState: () => true }),
      key({ key: "x", metaKey: true }),
      key(),
    ]) {
      expect(f.handle(event)).toBe(true);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(f.read).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });

  it("copies selection once and consumes all phases without shell input", () => {
    const f = fixture();
    for (const overrides of [{}, { repeat: true }, { type: "keypress" }, { type: "keyup" }]) {
      const event = key({ metaKey: true, ...overrides });
      expect(f.handle(event)).toBe(false);
      expect(event.preventDefault).toHaveBeenCalled();
    }
    expect(f.write).toHaveBeenCalledExactlyOnceWith("selected output");
    expect(f.terminal.paste).not.toHaveBeenCalled();
    f.terminal.getSelection.mockReturnValue("");
    f.handle(key({ metaKey: true }));
    expect(f.write).toHaveBeenCalledTimes(1);
  });

  it("pastes through xterm exactly once while clipboard reading is pending", async () => {
    const f = fixture();
    let resolve!: (text: string) => void;
    f.read.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const event = key({ key: "v", metaKey: true });
    f.handle(event);
    f.handle(event);
    expect(f.read).toHaveBeenCalledTimes(1);
    resolve("one\ntwo");
    await vi.waitFor(() => expect(f.terminal.paste).toHaveBeenCalledExactlyOnceWith("one\ntwo"));
  });

  it("does not paste into a closed, disconnected or unfocused terminal", async () => {
    const f = fixture();
    f.handle(key({ key: "v", metaKey: true }));
    f.canPaste.mockReturnValue(false);
    await Promise.resolve();
    expect(f.terminal.paste).not.toHaveBeenCalled();
    f.handle(key({ key: "v", metaKey: true }));
    expect(f.read).toHaveBeenCalledTimes(1);
  });

  it.each(["c", "v"])(
    "reports clipboard failure for %s without sending shell input",
    async (letter) => {
      const f = fixture();
      f.read.mockRejectedValue(new Error("Denied"));
      f.write.mockRejectedValue(new Error("Denied"));
      expect(f.handle(key({ key: letter, metaKey: true }))).toBe(false);
      await vi.waitFor(() => expect(f.report).toHaveBeenCalledTimes(1));
      expect(f.terminal.paste).not.toHaveBeenCalled();
    },
  );
});
