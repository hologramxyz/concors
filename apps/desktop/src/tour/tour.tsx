import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
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
  Loader2,
  Option,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { CommandId } from "@/shortcuts/bindings";
import { strokeLabel, strokeSymbols } from "@/shortcuts/keymap";
import { useShortcutPreferences } from "@/shortcuts/preferences-context";
import {
  cardPosition,
  frameInside,
  welcomeTitle,
  TOUR_STEPS,
  tourSteps,
  type Box,
  type TourStep,
  type TourTarget,
} from "./steps";
import { finishTour, useTour } from "./store";

const CARD_WIDTH = 300;
/** How long a step waits for its control to render (after opening a workspace) before centring. */
const FIND_TIMEOUT_MS = 800;
/** How long to wait for the default workspace before touring without it. */
const SETUP_TIMEOUT_MS = 10_000;
const HOLE_PADDING = 6;
/** Keeps the hole's 2px ring, and clear space, inside the window's edges. */
const HOLE_INSET = 8;
// Dark enough to pull the eye to the lit area, light enough that the app still reads behind it.
const DIM = "rgb(0 0 0 / 0.5)";

/**
 * `welcome` asks first; `setup` waits for a default workspace so every step has something real to
 * point at; a number is a step; `finish` closes the tour.
 */
type Phase = "welcome" | "setup" | number | "finish";

/** The first rendered match: kept-alive tabs leave hidden copies of the same control behind. */
function findTarget(target: TourTarget): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`))
    if (!element.closest("[inert]") && element.getClientRects().length) return element;
  return null;
}

/** The open menu a menu button controls, if any. */
function openMenu(trigger: HTMLElement): HTMLElement | null {
  const id = trigger.getAttribute("aria-controls");
  const menu = id ? document.getElementById(id) : null;
  return menu?.getAttribute("data-state") === "open" ? menu : null;
}

function boxOf(...elements: (HTMLElement | null)[]): Box {
  const rects = elements.flatMap((element) => (element ? [element.getBoundingClientRect()] : []));
  const top = Math.min(...rects.map((rect) => rect.top));
  const left = Math.min(...rects.map((rect) => rect.left));
  return {
    top,
    left,
    width: Math.max(...rects.map((rect) => rect.right)) - left,
    height: Math.max(...rects.map((rect) => rect.bottom)) - top,
  };
}

/**
 * Follows a step's area through layout changes, together with its menu when the step opens one;
 * null once it has not appeared in time. A menu step presses the real button to open the menu, and
 * closes it again when the step ends unless the person already did.
 */
function useStepBox(step: TourStep): Box | null | "pending" {
  const [box, setBox] = useState<Box | null | "pending">("pending");
  useEffect(() => {
    setBox("pending");
    const started = performance.now();
    let trigger: HTMLElement | null = null;
    let sawMenu = false;
    let frame = requestAnimationFrame(function follow() {
      const element = findTarget(step.target);
      if (element) {
        if (step.opensMenu && !trigger) {
          trigger = element;
          // Radix menus open on the primary button's pointerdown.
          if (element.getAttribute("aria-expanded") !== "true")
            element.dispatchEvent(
              new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
            );
        }
        const menu = step.opensMenu ? openMenu(element) : null;
        // Pressing Next closes the menu before the click lands; keep the spotlight and card where
        // they are, or the card slides away from under the pointer and the click misses.
        if (menu) sawMenu = true;
        else if (sawMenu) {
          frame = requestAnimationFrame(follow);
          return;
        }
        // Show the card once the menu is open, so it does not jump aside when the menu appears.
        if (step.opensMenu && !menu && performance.now() - started < FIND_TIMEOUT_MS) {
          frame = requestAnimationFrame(follow);
          return;
        }
        // A control can be part of a larger one the frame should take in whole, as ⌄ is of the
        // split "+" button.
        const next = boxOf(element.closest<HTMLElement>("[data-tour-frame]") ?? element, menu);
        setBox((current) =>
          current !== null &&
          current !== "pending" &&
          current.top === next.top &&
          current.left === next.left &&
          current.width === next.width &&
          current.height === next.height
            ? current
            : next,
        );
      } else if (performance.now() - started > FIND_TIMEOUT_MS) setBox(null);
      frame = requestAnimationFrame(follow);
    });
    return () => {
      cancelAnimationFrame(frame);
      // Escape reaches only the topmost layer, which is the menu while it is open.
      const menu = trigger && openMenu(trigger);
      if (menu) menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    };
  }, [step]);
  return box;
}

/**
 * The first-run tour over the whole window. On a device that has never seen it, a welcome screen
 * offers the tour or Skip; either answer is remembered. Someone with no workspace yet gets the
 * default one (a terminal in their home folder, as New workspace makes) so the tour can show tabs
 * and New tab for real. Each step dims the window and cuts a hole around one area of the app;
 * nothing behind it can be clicked until the tour ends, and Escape ends it. Replaying it from the
 * account menu or Search skips the welcome.
 */
export function Tour({
  ready,
  firstName,
  hasWorkspace,
  workspaceFailed,
  onPrepare,
  onCreateWorkspace,
  onAddWorkspace,
}: {
  /** The shell and its workspace have loaded, so the controls exist to point at. */
  ready: boolean;
  firstName: string;
  hasWorkspace: boolean;
  /** Creating the default workspace failed. */
  workspaceFailed: boolean;
  /** Puts the window where a step's area is visible: sidebar expanded, a workspace open. */
  onPrepare: (inWorkspace: boolean) => void;
  onCreateWorkspace: () => void;
  onAddWorkspace: () => void;
}) {
  const tour = useTour();
  const [phase, setPhase] = useState<Phase | null>(null);
  const [steps, setSteps] = useState<readonly TourStep[]>(TOUR_STEPS);
  const start = () => {
    if (hasWorkspace) {
      setSteps(TOUR_STEPS);
      setPhase(0);
    } else {
      onCreateWorkspace();
      setPhase("setup");
    }
  };
  if (ready && phase === null && tour.outcome === null) setPhase("welcome");
  else if (phase === "setup" && (hasWorkspace || workspaceFailed)) {
    setSteps(tourSteps(hasWorkspace));
    setPhase(0);
  }

  // Starting can create a workspace, so a replay starts from an effect rather than during render.
  const latestStart = useRef(start);
  const handledReplays = useRef(tour.replays);
  useLayoutEffect(() => {
    latestStart.current = start;
  });
  useEffect(() => {
    if (!ready || tour.replays === handledReplays.current) return;
    handledReplays.current = tour.replays;
    latestStart.current();
  }, [ready, tour.replays]);

  useEffect(() => {
    if (phase !== "setup") return;
    const timer = window.setTimeout(() => {
      setSteps(tourSteps(false));
      setPhase(0);
    }, SETUP_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const step = typeof phase === "number" ? steps[phase] : undefined;
  const prepare = useRef(onPrepare);
  useLayoutEffect(() => {
    prepare.current = onPrepare;
  });
  useEffect(() => {
    if (step) prepare.current(!!step.inWorkspace);
  }, [step]);

  if (phase === null) return null;
  const end = (outcome: "skipped" | "completed") => {
    setPhase(null);
    finishTour(outcome);
  };
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && end("skipped")}>
      <DialogPrimitive.Portal>
        {phase === "welcome" ? (
          <Welcome firstName={firstName} onStart={start} onSkip={() => end("skipped")} />
        ) : phase === "setup" ? (
          <Setup />
        ) : phase === "finish" ? (
          <Finish
            hasWorkspace={hasWorkspace}
            onDone={() => end("completed")}
            onAddWorkspace={() => {
              end("completed");
              onAddWorkspace();
            }}
          />
        ) : step ? (
          <Step
            step={step}
            index={phase}
            count={steps.length}
            onBack={() => setPhase(Math.max(0, phase - 1))}
            onNext={() => setPhase(phase + 1 < steps.length ? phase + 1 : "finish")}
            onSkip={() => end("skipped")}
          />
        ) : null}
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Backdrop() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[60] backdrop-blur-[1px]"
      style={{ background: DIM }}
    />
  );
}

function CentredCard({ children, label }: { children: ReactNode; label: string }) {
  return (
    <DialogPrimitive.Content
      aria-label={label}
      onInteractOutside={(event) => event.preventDefault()}
      className="fixed top-1/2 left-1/2 z-[61] flex w-[380px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-4 rounded-xl border bg-popover p-8 text-center text-ui text-popover-foreground shadow-lg outline-none"
    >
      {children}
    </DialogPrimitive.Content>
  );
}

function Welcome({
  firstName,
  onStart,
  onSkip,
}: {
  firstName: string;
  onStart: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <Backdrop />
      <CentredCard label="Welcome to Concors">
        <BrandMark className="size-12 text-foreground" />
        <div className="space-y-2">
          <DialogPrimitive.Title className="text-xl font-semibold">
            {welcomeTitle(firstName)}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-muted-foreground">
            Run coding agents side by side, right on your computer.
          </DialogPrimitive.Description>
        </div>
        <div className="flex w-full flex-col gap-2">
          <Button type="button" className="w-full" onClick={onStart} autoFocus>
            Take the tour
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={onSkip}>
            Skip
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Replay it any time from the account menu.</p>
      </CentredCard>
    </>
  );
}

function Setup() {
  return (
    <>
      <Backdrop />
      <CentredCard label="Setting up your first workspace">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <div className="space-y-2">
          <DialogPrimitive.Title className="text-[15px] font-semibold">
            Setting up your first workspace
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-muted-foreground">
            Creating a workspace in your home folder.
          </DialogPrimitive.Description>
        </div>
      </CentredCard>
    </>
  );
}

function Finish({
  hasWorkspace,
  onDone,
  onAddWorkspace,
}: {
  hasWorkspace: boolean;
  onDone: () => void;
  onAddWorkspace: () => void;
}) {
  return (
    <>
      <Backdrop />
      <CentredCard label="You’re all set">
        <BrandMark className="size-12 text-foreground" />
        <div className="space-y-2">
          <DialogPrimitive.Title className="text-xl font-semibold">
            You’re all set
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-muted-foreground">
            Type below to start, or click + for more.
          </DialogPrimitive.Description>
        </div>
        {hasWorkspace ? (
          <Button type="button" className="w-full" onClick={onDone} autoFocus>
            Start using Concors
          </Button>
        ) : (
          <div className="flex w-full flex-col gap-2">
            <Button type="button" className="w-full" onClick={onAddWorkspace} autoFocus>
              Add your first workspace
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={onDone}>
              Later
            </Button>
          </div>
        )}
      </CentredCard>
    </>
  );
}

function Step({
  step,
  index,
  count,
  onBack,
  onNext,
  onSkip,
}: {
  step: TourStep;
  index: number;
  count: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const box = useStepBox(step);
  const card = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{ index: number; height: number } | null>(null);
  useLayoutEffect(() => {
    if (card.current) setMeasured({ index, height: card.current.offsetHeight });
  }, [index, box]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight") onNext();
    else if (event.key === "ArrowLeft" && index > 0) onBack();
    else return;
    event.preventDefault();
  };
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const padding = step.framePadding ?? HOLE_PADDING;
  const hole =
    box && box !== "pending"
      ? frameInside(
          {
            top: box.top - padding,
            left: box.left - padding,
            width: box.width + padding * 2,
            height: box.height + padding * 2,
          },
          viewport,
          HOLE_INSET,
        )
      : null;
  const place = (height: number) =>
    hole
      ? cardPosition(hole, { width: CARD_WIDTH, height }, viewport)
      : { left: (viewport.width - CARD_WIDTH) / 2, top: (viewport.height - height) / 2 };
  // A card is placed once per step, after it has measured itself, and then stays put while the
  // area and its menu settle (a menu animating open, a list loading into it): a card that moves
  // under the pointer between press and release loses the click. Only a resized window moves it.
  const [placed, setPlaced] = useState<{
    index: number;
    viewport: string;
    position: { left: number; top: number };
  } | null>(null);
  const viewportKey = `${viewport.width}x${viewport.height}`;
  const settled = placed?.index === index && placed.viewport === viewportKey;
  const height = measured?.index === index ? measured.height : null;
  if (box !== "pending" && height !== null && !settled)
    setPlaced({ index, viewport: viewportKey, position: place(height) });
  const position = settled ? placed.position : place(height ?? 180);

  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-[60]">
        {hole ? (
          <Spotlight hole={hole} />
        ) : (
          <div className="absolute inset-0" style={{ background: DIM }} />
        )}
      </div>
      <DialogPrimitive.Content
        ref={card}
        onKeyDown={onKeyDown}
        // A stray click on the dimmed window must not throw away the tour; Escape and Skip end it.
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        // A menu the step holds open would take a press on the card as a click outside and close,
        // and the click that follows can then miss Next. The step closes the menu itself.
        onPointerDown={(event) => event.stopPropagation()}
        className="fixed z-[61] flex flex-col gap-3 rounded-xl border bg-popover p-4 text-ui text-popover-foreground shadow-lg outline-none"
        style={{
          ...position,
          width: CARD_WIDTH,
          maxWidth: "calc(100vw - 24px)",
          visibility: settled ? "visible" : "hidden",
          // An open menu would otherwise take pointer events from the card, costing a click.
          pointerEvents: "auto",
        }}
      >
        <span className="text-xs text-muted-foreground">
          {index + 1} of {count}
        </span>
        <div className="space-y-1">
          <DialogPrimitive.Title className="text-[15px] font-semibold">
            {step.title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-muted-foreground">
            {step.body}
          </DialogPrimitive.Description>
        </div>
        {step.shortcut && <StepShortcut id={step.shortcut} />}
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onSkip}>
            Skip tour
          </Button>
          <div className="ml-auto flex gap-2">
            {index > 0 && (
              <Button type="button" variant="outline" onClick={onBack}>
                Back
              </Button>
            )}
            {/* Mounted once the card shows: a hidden button cannot take focus. */}
            <StepNext
              key={settled ? index : `hidden-${index}`}
              label={index + 1 === count ? "Done" : "Next"}
              onNext={onNext}
            />
          </div>
        </div>
      </DialogPrimitive.Content>
    </>
  );
}

const GLIDE =
  "absolute transition-[top,left,width,height] duration-300 ease-out motion-reduce:transition-none";

/**
 * Four dim panels around the hole and a ring on its edge. A single element with a window-sized
 * box-shadow is the usual trick, but Chromium computed that shadow and never painted it.
 */
function Spotlight({ hole }: { hole: Box }) {
  const right = hole.left + hole.width;
  const bottom = hole.top + hole.height;
  const panels = [
    { top: 0, left: 0, right: 0, height: Math.max(0, hole.top) },
    { top: bottom, left: 0, right: 0, bottom: 0 },
    { top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height },
    { top: hole.top, left: right, right: 0, height: hole.height },
  ];
  return (
    <>
      {panels.map((panel, index) => (
        <div key={index} className={GLIDE} style={{ ...panel, background: DIM }} />
      ))}
      <div data-tour-hole className={`${GLIDE} rounded-lg ring-2 ring-primary/70`} style={hole} />
    </>
  );
}

/** Keyed by step, and by the card showing, so focus lands on Next each time, ready for Enter. */
function StepNext({ label, onNext }: { label: string; onNext: () => void }) {
  return (
    <Button type="button" onClick={onNext} autoFocus>
      {label}
    </Button>
  );
}

/**
 * The step's shortcut as the person has it bound, one key per chip so a sequence such as ⌃⇧P then →
 * reads as two presses. Nothing when the command has no binding.
 */
function StepShortcut({ id }: { id: CommandId }) {
  const { keymap, mac } = useShortcutPreferences();
  const binding = keymap[id][0];
  if (!binding) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {/* The chips speak for themselves on screen; a screen reader still hears what they are. */}
      <span className="sr-only">Shortcut</span>
      {binding.keys.map((stroke, index) => (
        <Fragment key={index}>
          {index > 0 && " then "}
          <Kbd className="h-6 px-1.5 text-[14px]">
            {mac ? <Symbols text={strokeSymbols(stroke)} /> : strokeLabel(stroke)}
          </Kbd>
        </Fragment>
      ))}
    </p>
  );
}

// Lucide pads each shape differently inside its box, so each icon gets the box that draws its shape
// as tall as the chip's capital letter; the caret, a short shape, as wide as one. All of them centre
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
function Symbols({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 leading-none">
      {Array.from(text).map((char, index) => {
        const icon = KEY_ICONS[char];
        if (!icon) return <span key={index}>{char}</span>;
        const [Icon, name, size, inset] = icon;
        // Trim the box to the shape plus a letter's side bearing, so the gaps match the letter's.
        const margin = KEY_SIDE_BEARING + KEY_STROKE / 2 - (inset * size) / 24;
        // One line weight for every icon whatever its box, as heavy as the letter's stem. Lucide
        // scales the line by the size prop, not the CSS size, so the size goes in as a prop.
        return (
          <Icon
            key={index}
            role="img"
            aria-label={name}
            size={size}
            style={{ width: size, height: size, marginInline: margin }}
            strokeWidth={KEY_STROKE}
            absoluteStrokeWidth
          />
        );
      })}
    </span>
  );
}
