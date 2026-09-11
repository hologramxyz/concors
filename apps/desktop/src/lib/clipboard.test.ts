import { afterEach, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

afterEach(() => vi.unstubAllGlobals());

it("reports a missing clipboard API as a rejected promise", async () => {
  vi.stubGlobal("navigator", {});
  await expect(copyText("hello")).rejects.toThrow("Clipboard access is unavailable.");
});

it("preserves the clipboard receiver when writing text", async () => {
  const clipboard = {
    async writeText(this: unknown, text: string) {
      expect(this).toBe(clipboard);
      expect(text).toBe("hello");
    },
  };
  vi.stubGlobal("navigator", { clipboard });
  await expect(copyText("hello")).resolves.toBeUndefined();
});

it.each([false, true])("rejects denied clipboard access (async: %s)", async (asyncFailure) => {
  const error = new Error("Denied");
  vi.stubGlobal("navigator", {
    clipboard: {
      writeText: () => {
        if (asyncFailure) return Promise.reject(error);
        throw error;
      },
    },
  });
  await expect(copyText("hello")).rejects.toBe(error);
});
