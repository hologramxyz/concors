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
import { useShortcutPreferences } from "./preferences-context";

/**
 * Keys as the tour and tooltips show them: one chip per stroke, so a sequence such as ⌃⇧P then →
 * reads as two presses. Mac symbols on a Mac, "Ctrl+Shift+P" elsewhere.
 */
export function KeyChips({
  strokes,
  mac,
  large = false,
}: {
  strokes: readonly ShortcutStroke[];
  mac: boolean;
  /** The tour's chip, beside its body text; a tooltip's text is smaller. */
  large?: boolean;
}) {
  return (
    <>
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
    </>
  );
}

/** A command's chips as this person has it bound. Nothing when the command has no binding. */
export function BoundKeyChips({ id }: { id: CommandId }) {
  const { keymap, mac } = useShortcutPreferences();
  const binding = keymap[id][0];
  return binding ? <KeyChips strokes={binding.keys} mac={mac} /> : null;
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
      {Array.from(text).map((char, index) => {
        const icon = KEY_ICONS[char];
        if (!icon) return <span key={index}>{char}</span>;
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
