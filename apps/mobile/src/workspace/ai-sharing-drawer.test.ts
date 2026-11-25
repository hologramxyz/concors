import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Modal: "Modal",
  View: "View",
  ScrollView: "ScrollView",
  Pressable: "Pressable",
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
vi.mock("../ui", () => ({
  Copy: "Copy",
  Button: "Button",
  useTheme: () => ({
    dark: false,
    muted: "#65665f",
    surface: "#ffffff",
    background: "#f4f3ef",
  }),
}));
import { Modal, Pressable } from "react-native";
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
  // Allow is the only answer: agents cannot work from the phone without it.
  expect(button("Don't allow")).toBeUndefined();
  await act(async () => button("Allow sharing").props.onPress());
  expect(answer).toHaveBeenCalledExactlyOnceWith(true);
});

it("is as wide as the phone, so the summary wraps instead of running off the screen", async () => {
  await act(async () => {
    renderer = create(createElement(AISharingContent, { disclosure, onAnswer: vi.fn() }));
  });
  const root = renderer!.root.find((node) => node.props.testID === "ai-sharing-drawer");
  expect(root.props.style).toMatchObject({ width: 390 });
});

it("covers the whole screen and cannot be closed, only allowed", async () => {
  const answer = vi.fn();
  await act(async () => {
    renderer = create(createElement(AISharingDrawer, { disclosure, onAnswer: answer }));
  });
  const modal = () => renderer!.root.findByType(Modal);
  expect(modal().props).toMatchObject({ visible: true, presentationStyle: "fullScreen" });
  // Android's back button, or any system dismissal, leaves it where it is.
  await act(async () => modal().props.onRequestClose());
  expect(modal().props.visible).toBe(true);
  expect(answer).not.toHaveBeenCalled();
  // No close, no decline: Allow is the only button on it.
  expect(renderer!.root.findAllByType(Button).map((node) => node.props.children)).toEqual([
    "Allow sharing",
  ]);
  await act(async () => button("Allow sharing").props.onPress());
  await act(async () => button("Allow sharing").props.onPress());
  expect(answer).toHaveBeenCalledExactlyOnceWith(true);
});
