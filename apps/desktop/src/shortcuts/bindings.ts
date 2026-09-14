export const BINDINGS = [
  { id: "search", label: "Search workspaces, agents and tabs", key: "k" },
  { id: "new-project", label: "New workspace", key: "n" },
  { id: "new-tab", label: "New tab…", key: "t", then: "Enter" },
  { id: "previous-tab", label: "Previous tab", key: "t", then: "ArrowLeft" },
  { id: "next-tab", label: "Next tab", key: "t", then: "ArrowRight" },
  { id: "new-pane", label: "New pane beside current", key: "p", then: "Enter" },
  { id: "split-left", label: "New pane to the left", key: "p", then: "ArrowLeft" },
  { id: "split-horizontal", label: "New pane to the right", key: "p", then: "ArrowRight" },
  { id: "split-up", label: "New pane above", key: "p", then: "ArrowUp" },
  { id: "split-vertical", label: "New pane below", key: "p", then: "ArrowDown" },
  { id: "focus-left", label: "Focus pane to the left", key: "ArrowLeft" },
  { id: "focus-right", label: "Focus pane to the right", key: "ArrowRight" },
  { id: "focus-up", label: "Focus pane above", key: "ArrowUp" },
  { id: "focus-down", label: "Focus pane below", key: "ArrowDown" },
  { id: "close-pane", label: "Close pane", key: "p", then: "Backspace" },
  { id: "close-tab", label: "Close tab", key: "t", then: "Backspace" },
  { id: "settings", label: "Settings", key: "," },
  { id: "shortcuts", label: "Shortcuts", key: "/" },
  { id: "rename-tab", label: "Rename tab", key: "F2", modifiers: [], context: "tab" },
  {
    id: "move-tab-left",
    label: "Move tab left",
    key: "ArrowLeft",
    modifiers: ["Alt", "Shift"],
    context: "tab",
  },
  {
    id: "move-tab-right",
    label: "Move tab right",
    key: "ArrowRight",
    modifiers: ["Alt", "Shift"],
    context: "tab",
  },
] as const;
export type CommandId = (typeof BINDINGS)[number]["id"];
/** Mobile exposes a flat tab list; pane shortcuts remain keyboard aliases, not extra UI. */
export const isCompactCommand = (id: CommandId) =>
  id !== "new-pane" &&
  id !== "close-pane" &&
  id !== "rename-tab" &&
  !id.startsWith("move-tab-") &&
  !id.startsWith("split-") &&
  !id.startsWith("focus-");
export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
export function keyLabel(key: string): string {
  return (
    ({ ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" } as Record<string, string>)[
      key
    ] ?? (key.length === 1 ? key.toUpperCase() : key)
  );
}
export function shortcutLabel(id: CommandId, mac = isMac()): string {
  const binding = BINDINGS.find((item) => item.id === id);
  if (!binding) return "";
  const modifiers = "modifiers" in binding ? binding.modifiers : ["Control", "Shift"];
  const prefix = modifiers
    .map((modifier) => (modifier === "Control" ? (mac ? "Control" : "Ctrl") : modifier))
    .join("+");
  return `${prefix ? `${prefix}+` : ""}${keyLabel(binding.key)}${"then" in binding ? ` → ${keyLabel(binding.then)}` : ""}`;
}
