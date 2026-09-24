import { expect, it } from "vitest";
import { keepsNativeContextMenu } from "./context-menu";

const element = (editable: boolean) =>
  ({ closest: () => (editable ? {} : null) }) as unknown as EventTarget;

it("suppresses the webview menu on ordinary app surfaces", () => {
  expect(keepsNativeContextMenu(element(false), "")).toBe(false);
  expect(keepsNativeContextMenu(null, "")).toBe(false);
});

it("keeps copy and paste for text fields and selected text", () => {
  expect(keepsNativeContextMenu(element(true), "")).toBe(true);
  expect(keepsNativeContextMenu(element(false), "some text")).toBe(true);
  expect(keepsNativeContextMenu(element(false), "  \n")).toBe(false);
});
