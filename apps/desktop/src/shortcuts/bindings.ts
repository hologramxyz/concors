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
  return [mac ? "Control" : "Ctrl", "Shift", binding?.key.toUpperCase() ?? ""].join("+");
}
export function matchShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "isComposing"
  >,
  mac: boolean,
  terminal: boolean,
): CommandId | undefined {
  if (event.isComposing || event.altKey) return;
  // Preserve the palette alias outside terminals; ordinary Ctrl+K belongs to the shell.
  if (!event.shiftKey) {
    const primaryOnly = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    return primaryOnly && !terminal && event.key.toLowerCase() === "k" ? "search" : undefined;
  }
  // On macOS, use the physical Control key. Command-based window/tab shortcuts
  // belong to the browser and cannot reliably be overridden by a page listener.
  if (!event.ctrlKey || event.metaKey) return;
  return BINDINGS.find(
    (binding) =>
      event.key.toLowerCase() === binding.key ||
      (binding.key === "," && event.code === "Comma") ||
      (binding.key === "/" && event.code === "Slash"),
  )?.id;
}
