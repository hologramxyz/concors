import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  View: "View",
  ScrollView: "ScrollView",
  Pressable: "Pressable",
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));
vi.mock("../ui", () => ({
  Copy: "Copy",
  Button: "Button",
  useTheme: () => ({ dark: false, muted: "#65665f", surface: "#ffffff" }),
}));
vi.mock("@expo/ui/swift-ui", () =>
  Object.fromEntries(["BottomSheet", "Group", "Host", "RNHostView"].map((name) => [name, name])),
);
vi.mock("@expo/ui/swift-ui/modifiers", () =>
  Object.fromEntries(
    ["preferredColorScheme", "presentationBackground", "presentationDragIndicator"].map((name) => [
      name,
      (value: unknown) => ({ name, value }),
    ]),
  ),
);
import { BottomSheet } from "@expo/ui/swift-ui";
import { Pressable } from "react-native";
import { AISharingContent } from "./ai-sharing-content";
import { AISharingDrawer } from "./ai-sharing-drawer.ios";
import { Button, Copy } from "../ui";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const disclosure = {
  summary: "Send prompts, code, files and chat context to Anthropic?",
  details:
    "Recipients: Anthropic / Claude. Retention depends on your account. Withdraw in Settings.",
};
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});
const button = (name: string) =>
  renderer!.root.findAllByType(Button).find((node) => node.props.children === name)!;

it("shows the short disclosure first, with optional details that never grant consent", async () => {
  const answer = vi.fn();
  await act(async () => {
    renderer = create(createElement(AISharingContent, { disclosure, onAnswer: answer }));
  });
  const texts = () => renderer!.root.findAllByType(Copy).map((node) => node.props.children);
  expect(texts()).toContain(disclosure.summary);
  expect(texts()).not.toContain(disclosure.details);
  const details = () => renderer!.root.findByType(Pressable);
  expect(details().props.accessibilityState).toEqual({ expanded: false });
  await act(async () => details().props.onPress());
  expect(texts()).toContain(disclosure.details);
  expect(details().props.accessibilityState).toEqual({ expanded: true });
  expect(answer).not.toHaveBeenCalled();
  await act(async () => details().props.onPress());
  expect(texts()).not.toContain(disclosure.details);
  await act(async () => button("Don't allow").props.onPress());
  expect(answer).toHaveBeenCalledExactlyOnceWith(false);
});

it.each([true, false])(
  "returns the explicit %s choice only after the native drawer dismisses",
  async (allow) => {
    const answer = vi.fn();
    await act(async () => {
      renderer = create(createElement(AISharingDrawer, { disclosure, onAnswer: answer }));
    });
    const sheet = () => renderer!.root.findByType(BottomSheet);
    expect(sheet().props.isPresented).toBe(true);
    expect(sheet().props.fitToContents).toBe(true);
    await act(async () => button(allow ? "Allow sharing" : "Don't allow").props.onPress());
    expect(sheet().props.isPresented).toBe(false);
    expect(answer).not.toHaveBeenCalled();
    await act(async () => sheet().props.onDismiss());
    expect(answer).toHaveBeenCalledExactlyOnceWith(allow);
    await act(async () => sheet().props.onDismiss());
    expect(answer).toHaveBeenCalledOnce();
  },
);

it("treats a swipe or outside dismissal as refusal", async () => {
  const answer = vi.fn();
  await act(async () => {
    renderer = create(createElement(AISharingDrawer, { disclosure, onAnswer: answer }));
  });
  const sheet = () => renderer!.root.findByType(BottomSheet);
  await act(async () => sheet().props.onIsPresentedChange(false));
  await act(async () => sheet().props.onDismiss());
  expect(answer).toHaveBeenCalledExactlyOnceWith(false);
});
