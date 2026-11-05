import { createElement, type ComponentProps } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@expo/ui/swift-ui", () =>
  Object.fromEntries(
    [
      "BottomSheet",
      "Button",
      "Divider",
      "HStack",
      "Image",
      "ScrollView",
      "Spacer",
      "Text",
      "VStack",
    ].map((name) => [name, name]),
  ),
);
vi.mock("@expo/ui/swift-ui/modifiers", () => ({
  shapes: { rectangle: () => "rectangle" },
  ...Object.fromEntries(
    [
      "accessibilityLabel",
      "accessibilityValue",
      "buttonStyle",
      "contentShape",
      "disabled",
      "environment",
      "font",
      "foregroundStyle",
      "frame",
      "padding",
      "presentationBackground",
      "presentationDetents",
      "presentationDragIndicator",
    ].map((name) => [name, (value: unknown) => ({ name, value })]),
  ),
}));
import { BottomSheet, Button, Divider, Image, Text } from "@expo/ui/swift-ui";
import { NativeControlPicker } from "./native-control-picker.ios";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer;
const back = {
  id: "__providers__",
  label: "← Providers",
  selected: false,
  navigate: true,
};
function props(): ComponentProps<typeof NativeControlPicker> {
  return {
    label: "Codex",
    options: [back, { id: "codex-model", label: "Codex model", selected: true }],
    dark: false,
    anchor: (onClick) => createElement("button", { onClick }),
    onSelect: vi.fn(),
    onPresent: vi.fn(),
  };
}
async function render(value: ComponentProps<typeof NativeControlPicker>) {
  await act(async () => {
    if (renderer) renderer.update(createElement(NativeControlPicker, value));
    else renderer = create(createElement(NativeControlPicker, value));
  });
}
const sheet = () => renderer.root.findByType(BottomSheet);
async function open() {
  await act(async () => sheet().props.anchor.props.onClick());
}
async function choose(label: string) {
  const button = renderer.root
    .findAllByType(Button)
    .find(
      (node) =>
        node.props.label === label ||
        node.props.modifiers?.some(
          (modifier: { name: string; value: unknown }) =>
            modifier.name === "accessibilityLabel" && modifier.value === label,
        ),
    );
  expect(button, label).toBeDefined();
  await act(async () => button!.props.onPress());
}
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined!;
});

it("keeps the presented sheet's background and text in sync with the app theme", async () => {
  const initial = props();
  await render(initial);
  await open();
  for (const dark of [false, true, false]) {
    await render({ ...initial, dark });
    // The presentation background must be explicit; content colorScheme leaves it system-themed.
    expect(sheet().props.children.props.modifiers).toEqual(
      expect.arrayContaining([
        { name: "presentationBackground", value: dark ? "#1f1f1f" : "#ffffff" },
        { name: "foregroundStyle", value: dark ? "#ededed" : "#20211f" },
      ]),
    );
    expect(sheet().props.isPresented).toBe(true);
  }
  expect(initial.onPresent).toHaveBeenCalledExactlyOnceWith(true);
  expect(initial.onSelect).not.toHaveBeenCalled();
});

it("keeps the native picker open across delayed provider/model pages and dismisses on a model choice", async () => {
  const initial = props();
  await render(initial);
  await open();
  expect(initial.onPresent).toHaveBeenCalledExactlyOnceWith(true);
  await choose("← Providers");
  expect(initial.onSelect).toHaveBeenLastCalledWith("__providers__");
  expect(sheet().props.isPresented).toBe(true);
  expect(initial.onPresent).toHaveBeenCalledTimes(1);

  // The renderer updates over the async WebView bridge; neither page change dismisses UIKit.
  await render({
    ...initial,
    label: "Providers",
    options: [{ id: "claude", label: "Claude Code", selected: false, navigate: true }],
  });
  expect(sheet().props.isPresented).toBe(true);
  await choose("Claude Code");
  expect(initial.onSelect).toHaveBeenLastCalledWith("claude");
  expect(sheet().props.isPresented).toBe(true);

  await render({ ...initial, label: "Claude Code", options: [back] });
  expect(sheet().props.isPresented).toBe(true);
  await render({
    ...initial,
    label: "Claude Code",
    options: [back, { id: "sonnet", label: "Sonnet", selected: false }],
  });
  await choose("Sonnet");
  expect(initial.onSelect).toHaveBeenLastCalledWith("sonnet");
  expect(sheet().props.isPresented).toBe(false);
  expect(initial.onPresent).toHaveBeenCalledTimes(1);
  await act(async () => sheet().props.onDismiss());
  expect(initial.onPresent).toHaveBeenLastCalledWith(false);
});

it.each(["Cancel", "swipe"])(
  "closes with %s without selecting and can be reopened",
  async (method) => {
    const initial = props();
    await render(initial);
    await open();
    if (method === "Cancel") await choose("Cancel");
    else await act(async () => sheet().props.onIsPresentedChange(false));
    expect(sheet().props.isPresented).toBe(false);
    expect(initial.onSelect).not.toHaveBeenCalled();
    // Focusing the composer before dismissal finishes can interrupt the sheet transition.
    expect(initial.onPresent).not.toHaveBeenCalledWith(false);
    await act(async () => sheet().props.onDismiss());
    expect(initial.onPresent).toHaveBeenLastCalledWith(false);
    await open();
    expect(sheet().props.isPresented).toBe(true);
  },
);

it("blocks stale choices when controls become disabled while the picker is open", async () => {
  const initial = props();
  await render(initial);
  await open();
  await render({ ...initial, blocked: true });
  await choose("Codex model");
  expect(initial.onSelect).not.toHaveBeenCalled();
  expect(sheet().props.isPresented).toBe(true);
  await choose("Cancel");
  await act(async () => sheet().props.onDismiss());
  await open();
  expect(sheet().props.isPresented).toBe(false);
});

it("shows a second line, dividers and the check on the current row only, and skips disabled rows", async () => {
  const initial = props();
  await render({
    ...initial,
    options: [
      back,
      { id: "codex", label: "Codex", selected: true, description: "Update available" },
      { id: "older", label: "Older", selected: false, divider: true },
      { id: "__update__", label: "Updating Codex…", selected: false, disabled: true },
    ],
  });
  await open();
  const texts = renderer.root
    .findAllByType(Text)
    .map((node) => node.props.children)
    .filter((text) => typeof text === "string");
  expect(texts).toEqual(
    expect.arrayContaining(["← Providers", "Codex", "Update available", "Older"]),
  );
  expect(texts.some((text) => /[✓:]/.test(text))).toBe(false);
  expect(renderer.root.findAllByType(Image)).toHaveLength(1);
  expect(renderer.root.findAllByType(Divider)).toHaveLength(2);
  await choose("Codex, Update available");
  expect(initial.onSelect).toHaveBeenLastCalledWith("codex");
  (initial.onSelect as ReturnType<typeof vi.fn>).mockClear();
  await open();
  await choose("Updating Codex…");
  expect(initial.onSelect).not.toHaveBeenCalled();
});
