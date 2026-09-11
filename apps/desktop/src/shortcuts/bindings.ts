export const BINDINGS = [
  { id: "search", label: "Search projects and commands", key: "k" },
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
] as const;
export type CommandId = (typeof BINDINGS)[number]["id"];
/** Mobile exposes a flat tab list; pane shortcuts remain keyboard aliases, not extra UI. */
export const isCompactCommand = (id: CommandId) =>
  id !== "new-pane" && id !== "close-pane" && !id.startsWith("split-") && !id.startsWith("focus-");
export type Sequence = "p" | "t";
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
  return `${mac ? "Control" : "Ctrl"}+Shift+${keyLabel(binding.key)}${"then" in binding ? ` → ${keyLabel(binding.then)}` : ""}`;
}
export function sequenceBindings(sequence: Sequence) {
  return BINDINGS.filter((binding) => binding.key === sequence && "then" in binding);
}
export function matchSequence(sequence: Sequence, key: string): CommandId | undefined {
  return sequenceBindings(sequence).find((binding) => "then" in binding && binding.then === key)
    ?.id;
}
export function matchShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "isComposing"
  >,
  mac: boolean,
  terminal: boolean,
  native = false,
): CommandId | Sequence | undefined {
  if (event.isComposing || event.altKey) return;
  if (native && event.key === "Tab" && event.ctrlKey && !event.metaKey)
    return event.shiftKey ? "previous-tab" : "next-tab";
  if (!event.shiftKey) {
    const primaryOnly = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    return primaryOnly && !terminal && event.key.toLowerCase() === "k" ? "search" : undefined;
  }
  if (!event.ctrlKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  if (key === "p" || key === "t") return key;
  return BINDINGS.find(
    (binding) =>
      !("then" in binding) &&
      (key === binding.key.toLowerCase() ||
        (binding.key === "," && event.code === "Comma") ||
        (binding.key === "/" && event.code === "Slash")),
  )?.id;
}
