import { expect, it } from "vitest";
import { isFileLink, localPreviewLink, previewLinkUrl } from "./preview-links";

it("recognises loopback dev-server links and keeps the page they point at", () => {
  expect(localPreviewLink("http://localhost:5173/pricing?plan=free#top")).toEqual({
    preview: { port: 5173, protocol: "http" },
    path: "/pricing?plan=free",
  });
  expect(localPreviewLink("https://127.0.0.1:8443")).toEqual({
    preview: { port: 8443, protocol: "https" },
    path: "/",
  });
  expect(localPreviewLink("http://0.0.0.0:3000/")?.preview.port).toBe(3000);
  expect(localPreviewLink("http://[::1]:4000/")?.preview.port).toBe(4000);
  expect(localPreviewLink("http://app.localhost:5173/")?.preview.port).toBe(5173);
  expect(localPreviewLink("http://localhost/")?.preview).toEqual({ port: 80, protocol: "http" });
});

it("leaves the web, files and other schemes alone", () => {
  expect(localPreviewLink("https://example.com:5173/")).toBeNull();
  expect(localPreviewLink("http://localhost.example.com/")).toBeNull();
  expect(localPreviewLink("ws://localhost:5173/")).toBeNull();
  expect(localPreviewLink("/tmp/shot.png")).toBeNull();
  expect(localPreviewLink("file:///tmp/shot.png")).toBeNull();
});

it("moves the page onto the preview address without touching its access fragment", () => {
  const link = localPreviewLink("http://localhost:5173/pricing?plan=free")!;
  expect(previewLinkUrl(link, "https://5173.m-1.concors.app/#access_token=abc")).toBe(
    "https://5173.m-1.concors.app/pricing?plan=free#access_token=abc",
  );
  expect(previewLinkUrl(link, "http://127.0.0.1:5173/")).toBe(
    "http://127.0.0.1:5173/pricing?plan=free",
  );
});

it("tells file references from web links", () => {
  for (const href of [
    "/tmp/plan-icon-browser/desktop.png",
    "src/app.ts",
    "file:///home/me/app.ts",
    "C:\\repo\\app.ts",
    "app.ts:12",
  ])
    expect(isFileLink(href), href).toBe(true);
  for (const href of ["https://example.com", "mailto:me@example.com", "#section", "//cdn.test/x"])
    expect(isFileLink(href), href).toBe(false);
});
