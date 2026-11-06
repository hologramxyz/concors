import { createElement, type ComponentProps } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@expo/ui/swift-ui", () => ({
  ...Object.fromEntries(
    [
      "BottomSheet",
      "Button",
      "HStack",
      "Image",
      "List",
      "NavigationDestination",
      "NavigationLink",
      "NavigationStack",
      "Section",
      "Spacer",
      "Text",
      "Toggle",
      "ToolbarItem",
      "VStack",
    ].map((name) => [name, name]),
  ),
  Toolbar: Object.assign(({ children }: { children: unknown }) => children, {
    Content: ({ children }: { children: unknown }) => children,
  }),
}));
vi.mock("@expo/ui/swift-ui/modifiers", () => ({
  ...Object.fromEntries(
    [
      "accessibilityLabel",
      "accessibilityValue",
      "background",
      "disabled",
      "font",
      "foregroundStyle",
      "labelStyle",
      "layoutPriority",
      "lineLimit",
      "listRowBackground",
      "listStyle",
      "navigationBarTitleDisplayMode",
      "navigationTitle",
      "preferredColorScheme",
      "presentationBackground",
      "presentationDetents",
      "presentationDragIndicator",
      "scrollContentBackground",
      "tint",
      "truncationMode",
    ].map((name) => [name, (value: unknown) => ({ name, value })]),
  ),
}));
import {
  BottomSheet,
  Button,
  Image,
  List,
  NavigationDestination,
  NavigationLink,
  NavigationStack,
  Section,
  Text,
  Toggle,
} from "@expo/ui/swift-ui";
import { NativeControlPicker } from "./native-control-picker.ios";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer;
type Node = ReactTestRenderer["root"];
const providers = {
  id: "model:providers",
  title: "Providers",
  options: [
    { id: "codex", label: "Codex", selected: true },
    { id: "claude", label: "Claude Code", selected: false, description: "Update available" },
  ],
};
const providerRow = {
  id: "model:providers",
  label: "Provider",
  value: "Codex",
  selected: false,
  navigate: true,
  section: true,
};
function props(): ComponentProps<typeof NativeControlPicker> {
  return {
    control: {
      id: "model",
      title: "Codex",
      options: [{ id: "codex-model", label: "Codex model", selected: true }, providerRow],
    },
    pages: [providers],
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
const stack = () => renderer.root.findByType(NavigationStack);
async function open() {
  await act(async () => sheet().props.anchor.props.onClick());
}
const modifier = (node: Node, name: string) =>
  node.props.modifiers?.find((item: { name: string }) => item.name === name)?.value;
/** The first page, or the page the stack would push for a value: both are always mounted. */
const page = (value?: string) =>
  value
    ? renderer.root.findAllByType(NavigationDestination).find((node) => node.props.value === value)!
    : renderer.root.findAllByType(List)[0]!;
function button(label: string, within: Node = renderer.root) {
  return within
    .findAllByType(Button)
    .find((node) => node.props.label === label || modifier(node, "accessibilityLabel") === label);
}
async function choose(label: string, within?: Node) {
  const node = button(label, within);
  expect(node, label).toBeDefined();
  await act(async () => node!.props.onPress());
}
const close = () => choose("Close");
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined!;
});

it("keeps the presented sheet's background and color scheme in sync with the app theme", async () => {
  const initial = props();
  await render(initial);
  await open();
  for (const dark of [false, true, false]) {
    await render({ ...initial, dark });
    // The presentation background must be explicit; content colorScheme leaves it system-themed.
    expect(stack().props.modifiers).toEqual(
      expect.arrayContaining([
        { name: "presentationBackground", value: dark ? "#1f1f1f" : "#ffffff" },
        { name: "preferredColorScheme", value: dark ? "dark" : "light" },
      ]),
    );
    expect(modifier(page(), "foregroundStyle")).toBe(dark ? "#ededed" : "#20211f");
    expect(sheet().props.isPresented).toBe(true);
  }
  expect(initial.onPresent).toHaveBeenCalledExactlyOnceWith(true);
  expect(initial.onSelect).not.toHaveBeenCalled();
});

it("draws inset grouped pages with the title in the bar and the close button on the first only", async () => {
  await render(props());
  await open();
  expect(modifier(page(), "listStyle")).toBe("insetGrouped");
  expect(modifier(page(), "navigationTitle")).toBe("Codex");
  expect(modifier(page(), "navigationBarTitleDisplayMode")).toBe("inline");
  expect(renderer.root.findAllByType(Section)).toHaveLength(3);
  const destination = page("model:providers");
  expect(modifier(destination.findByType(List), "navigationTitle")).toBe("Providers");
  expect(button("Close", destination)).toBeUndefined();
  const closer = button("Close")!;
  expect(closer.props.role).toBe("close");
  expect(closer.props.systemImage).toBe("xmark");
});

it("opens a page's row with its value beside it, and only rows naming a page of this sheet", async () => {
  const initial = props();
  await render({
    ...initial,
    pages: [providers, { id: "effort", title: "Thinking effort", options: [] }],
  });
  await open();
  // A page of the other sheet is not this sheet's destination.
  expect(
    renderer.root.findAllByType(NavigationDestination).map((node) => node.props.value),
  ).toEqual(["model:providers"]);
  const link = renderer.root.findByType(NavigationLink);
  expect(link.props.value).toBe("model:providers");
  expect(modifier(link, "accessibilityValue")).toBe("Codex");
  const [label, value] = link.findAllByType(Text);
  expect(label!.props.children).toBe("Provider");
  expect(modifier(label!, "layoutPriority")).toBe(1);
  expect(value!.props.children).toBe("Codex");
  // A long value gives way to the label and the chevron.
  expect(modifier(value!, "lineLimit")).toBe(1);
  expect(modifier(value!, "truncationMode")).toBe("tail");
});

it("returns to the previous page after a choice on a page, and stays open for the answer", async () => {
  const initial = props();
  await render(initial);
  await open();
  await act(async () => stack().props.onPathChange(["model:providers"]));
  expect(stack().props.path).toEqual(["model:providers"]);
  await choose("Claude Code, Update available", page("model:providers"));
  expect(initial.onSelect).toHaveBeenLastCalledWith("model:providers", "claude");
  expect(stack().props.path).toEqual([]);
  expect(sheet().props.isPresented).toBe(true);
  expect(initial.onPresent).toHaveBeenCalledTimes(1);

  // The renderer updates over the async WebView bridge; the page change doesn't dismiss UIKit.
  await render({
    ...initial,
    control: {
      id: "model",
      title: "Claude Code",
      options: [{ id: "sonnet", label: "Sonnet", selected: false }, providerRow],
    },
  });
  expect(sheet().props.isPresented).toBe(true);
  await choose("Sonnet");
  expect(initial.onSelect).toHaveBeenLastCalledWith("model", "sonnet");
  expect(sheet().props.isPresented).toBe(false);
  expect(initial.onPresent).toHaveBeenCalledTimes(1);
  await act(async () => sheet().props.onDismiss());
  expect(initial.onPresent).toHaveBeenLastCalledWith(false);
});

it("closes the whole sheet for a choice that answers with a dialog over it", async () => {
  const initial = props();
  const older = {
    id: "model:older",
    title: "Older models",
    options: [{ id: "old", label: "Old", selected: false, closes: true }],
  };
  await render({
    ...initial,
    pages: [older],
    control: {
      ...initial.control,
      options: [{ id: "model:older", label: "Older models", selected: false, navigate: true }],
    },
  });
  await open();
  await act(async () => stack().props.onPathChange(["model:older"]));
  await choose("Old", page("model:older"));
  expect(initial.onSelect).toHaveBeenLastCalledWith("model:older", "old");
  expect(sheet().props.isPresented).toBe(false);
});

it("drops a page that goes away while it is open, and opens on the first page again", async () => {
  const initial = props();
  await render(initial);
  await open();
  await act(async () => stack().props.onPathChange(["model:providers"]));
  await render({ ...initial, pages: [] });
  expect(stack().props.path).toEqual([]);
  await render(initial);
  await act(async () => stack().props.onPathChange(["model:providers"]));
  await close();
  await act(async () => sheet().props.onDismiss());
  await open();
  expect(stack().props.path).toEqual([]);
});

it("keeps a switch's sheet open and flips it through the choice", async () => {
  const initial = props();
  await render({
    ...initial,
    control: {
      id: "options",
      title: "Options",
      options: [{ id: "plan", label: "Plan mode", selected: true, toggle: true }],
    },
  });
  await open();
  const toggle = renderer.root.findByType(Toggle);
  expect(toggle.props).toMatchObject({ label: "Plan mode", isOn: true });
  await act(async () => toggle.props.onIsOnChange(false));
  expect(initial.onSelect).toHaveBeenLastCalledWith("options", "plan");
  expect(sheet().props.isPresented).toBe(true);
});

it.each(["Close", "swipe"])(
  "closes with %s without selecting and can be reopened",
  async (method) => {
    const initial = props();
    await render(initial);
    await open();
    if (method === "Close") await close();
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
  await close();
  await act(async () => sheet().props.onDismiss());
  await open();
  expect(sheet().props.isPresented).toBe(false);
});

it("shows a second line and the check on the current row only, and skips disabled rows", async () => {
  const initial = props();
  await render({
    ...initial,
    control: {
      id: "model",
      title: "Codex",
      options: [
        { id: "codex", label: "Codex", selected: true, description: "Update available" },
        { id: "older", label: "Older", selected: false, section: true },
        { id: "__update__", label: "Updating Codex…", selected: false, disabled: true },
      ],
    },
  });
  await open();
  const texts = page()
    .findAllByType(Text)
    .map((node) => node.props.children);
  expect(texts).toEqual(["Codex", "Update available", "Older", "Updating Codex…"]);
  expect(texts.some((text) => /[✓:]/.test(text))).toBe(false);
  expect(page().findAllByType(Image)).toHaveLength(1);
  expect(page().findAllByType(Section)).toHaveLength(2);
  await choose("Codex, Update available");
  expect(initial.onSelect).toHaveBeenLastCalledWith("model", "codex");
  (initial.onSelect as ReturnType<typeof vi.fn>).mockClear();
  await open();
  await choose("Updating Codex…");
  expect(initial.onSelect).not.toHaveBeenCalled();
});
