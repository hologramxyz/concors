import { expect, it } from "vitest";
import { carriesFiles } from "./file-drops";
import config from "../../src-tauri/tauri.conf.json";
import linuxConfig from "../../src-tauri/tauri.linux.conf.json";

it("recognises drags that carry files", () => {
  expect(carriesFiles({ types: ["Files", "text/uri-list"] })).toBe(true);
  expect(carriesFiles({ types: ["text/plain"] })).toBe(false);
  expect(carriesFiles(null)).toBe(false);
});

// With Tauri's own handler on, the webview never sees file drops, and the composer silently
// ignores them. The Linux config replaces the whole window list, so both files need the flag.
it.each([
  ["tauri.conf.json", config],
  ["tauri.linux.conf.json", linuxConfig],
])("%s hands file drops to the page", (_, { app }) => {
  for (const window of app.windows as { dragDropEnabled?: boolean }[])
    expect(window.dragDropEnabled).toBe(false);
});
