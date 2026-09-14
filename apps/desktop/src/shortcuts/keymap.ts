import {
  ShortcutOverridesSchema,
  type Shortcut,
  type ShortcutOverrides,
  type ShortcutStroke,
} from "@concors/client-core";
import { BINDINGS, keyLabel, type CommandId } from "./bindings";

export type Keymap = Record<CommandId, readonly Shortcut[]>;
export type ShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "isComposing"
>;
const modifierOrder = ["Control", "Alt", "Shift", "Meta"] as const;
const punctuation: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};

export function eventStroke(event: ShortcutEvent): ShortcutStroke | null {
  if (
    event.isComposing ||
    ["Control", "Alt", "Shift", "Meta", "AltGraph", "Dead", "Unidentified", "Process"].includes(
      event.key,
    )
  )
    return null;
  const key =
    punctuation[event.code] ?? (/^Digit\d$/.test(event.code) ? event.code.slice(-1) : event.key);
  return {
    key: key.length === 1 ? key.toLowerCase() : key,
    modifiers: modifierOrder.filter(
      (modifier) =>
        ({ Control: event.ctrlKey, Alt: event.altKey, Shift: event.shiftKey, Meta: event.metaKey })[
          modifier
        ],
    ),
  };
}
export function strokeId(stroke: ShortcutStroke): string {
  return [
    ...modifierOrder.filter((modifier) => stroke.modifiers.includes(modifier)),
    stroke.key.toLowerCase(),
  ].join("+");
}
export function strokeLabel(stroke: ShortcutStroke, mac = false): string {
  return [
    ...modifierOrder
      .filter((modifier) => stroke.modifiers.includes(modifier))
      .map((modifier) =>
        modifier === "Control"
          ? mac
            ? "Control"
            : "Ctrl"
          : modifier === "Meta"
            ? mac
              ? "Command"
              : "Win"
            : modifier,
      ),
    stroke.key === " " ? "Space" : keyLabel(stroke.key),
  ].join("+");
}
export function bindingLabel(binding: Shortcut, mac = false): string {
  return binding.keys.map((key) => strokeLabel(key, mac)).join(" → ");
}
export function defaultKeymap(mac = false): Keymap {
  const result = Object.fromEntries(
    BINDINGS.map((binding) => [
      binding.id,
      [
        {
          keys: [
            {
              key: binding.key,
              modifiers: "modifiers" in binding ? binding.modifiers : ["Control", "Shift"],
            },
            ...("then" in binding ? [{ key: binding.then, modifiers: [] }] : []),
          ],
          context: "context" in binding ? binding.context : "app",
        },
      ],
    ]),
  ) as unknown as Keymap;
  result.search = [
    ...result.search,
    { keys: [{ key: "k", modifiers: [mac ? "Meta" : "Control"] }], context: "outside-terminal" },
  ];
  result["next-tab"] = [
    ...result["next-tab"],
    { keys: [{ key: "Tab", modifiers: ["Control"] }], context: "native" },
  ];
  result["previous-tab"] = [
    ...result["previous-tab"],
    { keys: [{ key: "Tab", modifiers: ["Control", "Shift"] }], context: "native" },
  ];
  return result;
}
export function bindingError(binding: Shortcut): string | null {
  const first = binding.keys[0];
  if (!first || binding.keys.length > 2)
    return "Choose one key combination or a two-step sequence.";
  if (
    binding.keys.some(
      (key) =>
        !eventStroke({
          key: key.key,
          code: "",
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          metaKey: false,
          isComposing: false,
        }) || key.key === "Escape",
    )
  )
    return "Choose a key other than Escape or a modifier on its own.";
  if (
    !first.modifiers.some((modifier) => modifier !== "Shift") &&
    !/^F([1-9]|1\d|2[0-4])$/.test(first.key)
  )
    return "Start with Control, Command/Win, or Alt plus a key, or a function key.";
  return null;
}
export function parseOverrides(raw: unknown): ShortcutOverrides {
  const parsed = ShortcutOverridesSchema.safeParse(raw);
  if (!parsed.success) return {};
  return Object.fromEntries(
    Object.entries(parsed.data).filter(
      ([id, bindings]) =>
        BINDINGS.some((command) => command.id === id) &&
        bindings.every((binding) => !bindingError(binding)),
    ),
  );
}
export function resolveKeymap(overrides: ShortcutOverrides, mac = false): Keymap {
  const defaults = defaultKeymap(mac);
  return Object.fromEntries(
    BINDINGS.map(({ id }) => [id, overrides[id] ?? defaults[id]]),
  ) as Keymap;
}
export function shortcutsConflict(left: Shortcut, right: Shortcut): boolean {
  const firstLeft = left.keys[0],
    firstRight = right.keys[0];
  if (!firstLeft || !firstRight) return false;
  // A single key cannot also be a sequence prefix. Different second keys can share a prefix.
  if (
    left.keys.slice(0, Math.min(left.keys.length, right.keys.length)).every((key, index) => {
      const other = right.keys[index];
      return other && strokeId(key) === strokeId(other);
    })
  )
    return true;
  const a = left.keys[1],
    b = right.keys[1];
  if (
    !a ||
    !b ||
    strokeId(firstLeft) !== strokeId(firstRight) ||
    a.key.toLowerCase() !== b.key.toLowerCase()
  )
    return false;
  return (
    (!a.modifiers.length &&
      b.modifiers.every((modifier) => firstLeft.modifiers.includes(modifier))) ||
    (!b.modifiers.length &&
      a.modifiers.every((modifier) => firstRight.modifiers.includes(modifier)))
  );
}
export function parseStroke(text: string): ShortcutStroke | null {
  const parts = text.split("+").map((part) => part.trim());
  const rawKey = parts.pop();
  if (!rawKey) return null;
  const modifiers: ShortcutStroke["modifiers"] = [];
  const aliases: Record<string, ShortcutStroke["modifiers"][number]> = {
    ctrl: "Control",
    control: "Control",
    alt: "Alt",
    option: "Alt",
    shift: "Shift",
    meta: "Meta",
    command: "Meta",
    cmd: "Meta",
    win: "Meta",
    super: "Meta",
  };
  for (const part of parts) {
    const modifier = aliases[part.toLowerCase()];
    if (!modifier || modifiers.includes(modifier)) return null;
    modifiers.push(modifier);
  }
  const namedKeys = [
    "Escape",
    "Enter",
    "Tab",
    "Backspace",
    "Delete",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Insert",
    ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
  ];
  const symbols: Record<string, string> = {
    "←": "ArrowLeft",
    "→": "ArrowRight",
    "↑": "ArrowUp",
    "↓": "ArrowDown",
  };
  const key =
    symbols[rawKey] ??
    (rawKey.toLowerCase() === "space"
      ? " "
      : (namedKeys.find((key) => key.toLowerCase() === rawKey.toLowerCase()) ??
        (rawKey.length === 1 ? rawKey.toLowerCase() : null)));
  return key ? { key, modifiers } : null;
}
export function conflictsFor(id: CommandId, bindings: readonly Shortcut[], keymap: Keymap) {
  return BINDINGS.flatMap((command) =>
    command.id === id
      ? []
      : keymap[command.id].flatMap((binding, index) =>
          bindings.some((candidate) => shortcutsConflict(binding, candidate))
            ? [{ id: command.id, label: command.label, index, binding }]
            : [],
        ),
  );
}
export function updateBindings(
  overrides: ShortcutOverrides,
  id: CommandId,
  bindings: Shortcut[] | undefined,
  mac: boolean,
  reassign = false,
): ShortcutOverrides {
  const next: ShortcutOverrides =
    bindings === undefined
      ? Object.fromEntries(Object.entries(overrides).filter(([command]) => command !== id))
      : { ...overrides, [id]: bindings };
  const keymap = resolveKeymap(next, mac);
  const conflicts = conflictsFor(id, keymap[id], keymap);
  if (conflicts.length && !reassign)
    throw new Error(
      `Already used by ${[...new Set(conflicts.map((conflict) => conflict.label))].join(", ")}.`,
    );
  for (const conflict of conflicts)
    next[conflict.id] = keymap[conflict.id].filter(
      (binding) => !keymap[id].some((candidate) => shortcutsConflict(binding, candidate)),
    );
  return next;
}
export interface KeymapEntry {
  id: CommandId;
  label: string;
  binding: Shortcut;
  index: number;
}
export function keymapEntries(keymap: Keymap): KeymapEntry[] {
  return BINDINGS.flatMap(({ id, label }) =>
    keymap[id].map((binding, index) => ({ id, label, binding, index })),
  );
}
export function matchKeymap(
  event: ShortcutEvent,
  keymap: Keymap,
  terminal: boolean,
  native: boolean,
  tab = false,
): KeymapEntry[] {
  const stroke = eventStroke(event);
  if (!stroke) return [];
  return keymapEntries(keymap).filter(
    ({ binding }) =>
      !(terminal && binding.context === "outside-terminal") &&
      !(binding.context === "native" && !native) &&
      !(binding.context === "tab" && !tab) &&
      !!binding.keys[0] &&
      strokeId(binding.keys[0]) === strokeId(stroke),
  );
}
export function matchContinuation(
  event: ShortcutEvent,
  entries: readonly KeymapEntry[],
): KeymapEntry | undefined {
  const stroke = eventStroke(event);
  if (!stroke) return;
  return entries.find(({ binding }) => {
    const first = binding.keys[0],
      second = binding.keys[1];
    if (!first || !second) return false;
    if (strokeId(second) === strokeId(stroke)) return true;
    // Default arrow/Enter actions also work while the first stroke's modifiers are still held.
    return (
      !second.modifiers.length &&
      second.key.toLowerCase() === stroke.key.toLowerCase() &&
      stroke.modifiers.every((modifier) => first.modifiers.includes(modifier))
    );
  });
}
export function browserWarning(binding: Shortcut, mac: boolean): string | null {
  const first = binding.keys[0];
  if (!first || binding.context === "native") return null;
  const primary = first.modifiers.includes(mac ? "Meta" : "Control");
  const key = first.key.toLowerCase();
  if (
    (primary && ["w", "t", "n", "q", "l", "r", "tab"].includes(key)) ||
    ["F1", "F5", "F11", "F12"].includes(first.key) ||
    (first.modifiers.includes("Alt") && ["F4", "Tab"].includes(first.key))
  )
    return "Your browser or operating system may reserve this shortcut. Choose another combination if it does not reach Concors.";
  return null;
}
