export const BINDINGS = [
  { id: "search", label: "Search projects and commands", key: "k" },
  { id: "new-project", label: "New project", key: "n" },
  { id: "new-tab", label: "New tab…", key: "t" },
  { id: "new-pane", label: "New pane", key: "p" },
  { id: "split-horizontal", label: "Split horizontally (side by side)", key: "d" },
  { id: "split-vertical", label: "Split vertically (stacked)", key: "e" },
  { id: "close-pane", label: "Close pane", key: "w" },
  { id: "close-tab", label: "Close tab", key: "x" },
  { id: "settings", label: "Settings", key: "," },
  { id: "shortcuts", label: "Keyboard shortcuts", key: "/" },
] as const;
export type CommandId = (typeof BINDINGS)[number]["id"];
export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
export function shortcutLabel(id: CommandId, mac = isMac()): string {
  const binding = BINDINGS.find((item) => item.id === id);
  return [mac ? "⌘" : "Ctrl", "Shift", binding?.key.toUpperCase() ?? ""].join("+");
}
export function matchShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "isComposing"
  >,
  mac: boolean,
  terminal: boolean,
): CommandId | undefined {
  if (
    event.isComposing ||
    event.altKey ||
    (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey)
  )
    return;
  // Preserve the existing palette shortcut outside terminals. Ctrl+K belongs to the shell.
  if (!event.shiftKey) return !terminal && event.key.toLowerCase() === "k" ? "search" : undefined;
  return BINDINGS.find(
    (binding) =>
      event.key.toLowerCase() === binding.key ||
      (binding.key === "," && event.code === "Comma") ||
      (binding.key === "/" && event.code === "Slash"),
  )?.id;
}
