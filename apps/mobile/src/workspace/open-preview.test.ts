import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ browser: vi.fn() }));
vi.mock("expo-web-browser", () => ({
  openBrowserAsync: mocks.browser,
  WebBrowserPresentationStyle: { PAGE_SHEET: "pageSheet" },
}));
import { openPreviewInApp } from "./open-preview";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.browser.mockResolvedValue({ type: "cancel" });
});

it("opens the signed-in preview address in a draggable in-app sheet, keeping its fragment", () => {
  const url =
    "https://8790.m-ttc1e26aym.concors.app/__concors/preview-auth#access_token=t&path=%2Fjobs";
  openPreviewInApp(url);
  expect(mocks.browser).toHaveBeenCalledExactlyOnceWith(url, {
    presentationStyle: "pageSheet",
    createTask: false,
  });
});

it("returns while the preview is still open, so the renderer's request does not time out", () => {
  // The system browser's promise settles only when the person closes it.
  mocks.browser.mockReturnValue(new Promise(() => undefined));
  expect(openPreviewInApp("https://8790.m-ttc1e26aym.concors.app/")).toBeUndefined();
  expect(mocks.browser).toHaveBeenCalledOnce();
});

it("does not leave a failed presentation unhandled", async () => {
  mocks.browser.mockRejectedValue(new Error("Another browser is already open"));
  expect(() => openPreviewInApp("https://8790.m-ttc1e26aym.concors.app/")).not.toThrow();
  await Promise.resolve();
});

it.each([
  "http://8790.m-ttc1e26aym.concors.app/",
  "https://user:pass@8790.m-ttc1e26aym.concors.app/",
  "javascript:alert(1)",
])("refuses %s", (url) => {
  expect(() => openPreviewInApp(url)).toThrow();
  expect(mocks.browser).not.toHaveBeenCalled();
});
