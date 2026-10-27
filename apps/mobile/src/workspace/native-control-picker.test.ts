import { createElement, type ComponentProps } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@expo/ui/swift-ui", () =>
  Object.fromEntries(
    ["BottomSheet", "Button", "Divider", "HStack", "ScrollView", "Spacer", "Text", "VStack"].map(
      (name) => [name, name],
    ),
  ),
);
vi.mock("@expo/ui/swift-ui/modifiers", () =>
  Object.fromEntries(
    [
      "accessibilityLabel",
      "buttonStyle",
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
);
import { BottomSheet, Button } from "@expo/ui/swift-ui";
import { NativeControlPicker } from "./native-control-picker.ios";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer;
const back = {
  id: "__providers__",
  label: "Back to providers",
  selected: false,
  navigate: true,
};
function props(): ComponentProps<typeof NativeControlPicker> {
  return {
    label: "Codex · Agent and model",
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
  const button = renderer.root.findAllByType(Button).find((node) => node.props.label === label);
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
  await choose("Back to providers");
  expect(initial.onSelect).toHaveBeenLastCalledWith("__providers__");
  expect(sheet().props.isPresented).toBe(true);
  expect(initial.onPresent).toHaveBeenCalledTimes(1);

  // The renderer updates over the async WebView bridge; neither page change dismisses UIKit.
  await render({
    ...initial,
    label: "Choose an agent provider",
    options: [{ id: "claude", label: "Claude Code", selected: false, navigate: true }],
  });
  expect(sheet().props.isPresented).toBe(true);
  await choose("Claude Code");
  expect(initial.onSelect).toHaveBeenLastCalledWith("claude");
  expect(sheet().props.isPresented).toBe(true);

  await render({ ...initial, label: "Claude Code · Agent and model", options: [back] });
  expect(sheet().props.isPresented).toBe(true);
  await render({
    ...initial,
    label: "Claude Code · Agent and model",
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
  await choose("✓ Codex model");
  expect(initial.onSelect).not.toHaveBeenCalled();
  expect(sheet().props.isPresented).toBe(true);
  await choose("Cancel");
  await act(async () => sheet().props.onDismiss());
  await open();
  expect(sheet().props.isPresented).toBe(false);
});
