import { Fragment } from "react";
import {
  ArrowBigUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronUp,
  Command,
  CornerDownLeft,
  Delete,
  Option,
  type LucideIcon,
} from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { isMac, type CommandId } from "./bindings";
import type { ShortcutStroke } from "@concors/client-core";
import { parseShortcutText, strokeLabel, strokeSymbols } from "./keymap";
import { useMainBinding, useShortcutPreferences } from "./preferences-context";

/**
 * Keys as the app shows them everywhere: one chip per stroke, so a sequence such as ⌃⇧P then → reads
 * as two presses. Mac symbols on a Mac, "Ctrl+Shift+P" elsewhere.
 */
export function KeyChips({
  strokes,
  mac,
  large = false,
}: {
  strokes: readonly ShortcutStroke[];
  mac: boolean;
  /** The chip for beside 15px body text, as in the tour; tooltips and lists use the smaller one. */
  large?: boolean;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      {strokes.map((stroke, index) => (
        <Fragment key={index}>
          {index > 0 && " then "}
          <Kbd className={large ? "h-6 px-1.5 text-[14px]" : "shrink-0"}>
            {mac ? (
              <Symbols text={strokeSymbols(stroke)} scale={large ? 1 : 12 / 14} />
            ) : (
              strokeLabel(stroke)
            )}
          </Kbd>
        </Fragment>
      ))}
    </span>
  );
}

/** A command's main shortcut as chips. Nothing when the command has no binding here. */
export function BoundKeyChips({ id }: { id: CommandId }) {
  const { mac } = useShortcutPreferences();
  const binding = useMainBinding(id);
  return binding ? <KeyChips strokes={binding.keys} mac={mac} /> : null;
}

/** A secondary binding beside a main chip: the same keys, without a chip's weight. */
export function PlainKeys({ strokes, mac }: { strokes: readonly ShortcutStroke[]; mac: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {strokes.map((stroke, index) => (
        <Fragment key={index}>
          {index > 0 && " then "}
          {mac ? (
            <Symbols text={strokeSymbols(stroke)} scale={12 / 14} />
          ) : (
            <span>{strokeLabel(stroke)}</span>
          )}
        </Fragment>
      ))}
    </span>
  );
}

/**
 * A menu row's shortcut, at the row's end. Hidden from screen readers so the row's name stays its
 * label.
 */
export function MenuKeyChips({ id }: { id: CommandId }) {
  return (
    <span aria-hidden="true" className="-my-1 ml-auto flex shrink-0 pl-4">
      <BoundKeyChips id={id} />
    </span>
  );
}

/** A fixed shortcut, written as text such as "Shift+Tab", drawn with the same chips. */
export function TextKeyChips({ text }: { text: string }) {
  const strokes = isMac() ? parseShortcutText(text) : null;
  return strokes ? <KeyChips strokes={strokes} mac /> : <Kbd className="shrink-0">{text}</Kbd>;
}

// Lucide pads each shape differently inside its box, so each icon gets the box that draws its shape
// as tall as a 14px capital letter; the caret, a short shape, as wide as one. All of them centre
// on the letter. The last number is the blank space each side of the shape, in Lucide's 24-unit
// grid, so the icon can be spaced by its shape rather than its box.
const KEY_ICONS: Record<string, [LucideIcon, string, number, number]> = {
  "⌃": [ChevronUp, "Control", 18, 6],
  "⌥": [Option, "Option", 12, 3],
  "⇧": [ArrowBigUp, "Shift", 12.75, 4],
  "⌘": [Command, "Command", 11.5, 3],
  "↩": [CornerDownLeft, "Return", 12.75, 4],
  "⌫": [Delete, "Delete", 12.75, 2],
  "←": [ArrowLeft, "Left arrow", 12.75, 5],
  "→": [ArrowRight, "Right arrow", 12.75, 5],
  "↑": [ArrowUp, "Up arrow", 12.75, 5],
  "↓": [ArrowDown, "Down arrow", 12.75, 5],
};
const KEY_STROKE = 1.5;
/** The blank space a letter of the chip's font leaves each side of its shape. */
const KEY_SIDE_BEARING = 1.25;

/**
 * Key symbols as icons rather than text: the font draws each symbol at its own size and height (⌃
 * small and high, ⇧ large), so as text they never line up with the letter beside them. One tight
 * row, the way a Mac menu writes ⌃⇧N, with the same space between every two shapes.
 */
function Symbols({ text, scale }: { text: string; scale: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 leading-none">
      {/* Letters stay together, so a named key reads as F2 rather than F 2. */}
      {(text.match(/[^\p{Script=Latin}\d]|[\p{Script=Latin}\d]+/gu) ?? []).map((part, index) => {
        const icon = KEY_ICONS[part];
        if (!icon) return <span key={index}>{part}</span>;
        const [Icon, name, box, inset] = icon;
        const size = box * scale;
        // Trim the box to the shape plus a letter's side bearing, so the gaps match the letter's.
        const margin = (KEY_SIDE_BEARING + KEY_STROKE / 2) * scale - (inset * size) / 24;
        // One line weight for every icon whatever its box, as heavy as the letter's stem. Lucide
        // scales the line by the size prop, not the CSS size, so the size goes in as a prop.
        return (
          <Icon
            key={index}
            role="img"
            aria-label={name}
            size={size}
            style={{ width: size, height: size, marginInline: margin }}
            strokeWidth={KEY_STROKE * scale}
            absoluteStrokeWidth
          />
        );
      })}
    </span>
  );
}
