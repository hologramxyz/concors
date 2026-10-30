import type { CommandId } from "@/shortcuts/bindings";

/**
 * The first-run tour: a welcome screen, then one step per feature worth knowing about, each
 * spotlighting the real part of the app. The everyday loop on this computer comes first and the
 * cloud last, the way Notion, Raycast and Warp leave their paid tier for the end of onboarding.
 *
 * Areas a step points at carry `data-tour="<id>"`. A step that opens a menu lights the menu too,
 * so people see its choices (Agent beside Terminal, this computer beside cloud machines). Copy is
 * one short line, naming controls as the app labels them.
 */
export type TourTarget = "workspaces" | "tabs" | "new-tab" | "schedules" | "search" | "machines";

export interface TourStep {
  readonly target: TourTarget;
  readonly title: string;
  readonly body: string;
  readonly shortcut?: CommandId;
  /** The target is a menu button: open the menu for this step and close it after. */
  readonly opensMenu?: boolean;
  /** The target lives inside an open workspace. */
  readonly inWorkspace?: boolean;
  /** Space between the lit area and its frame, when the default would run over a neighbour. */
  readonly framePadding?: number;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: "workspaces",
    title: "Workspaces",
    body: "Each workspace is tied to a folder, and its agents work there.",
    shortcut: "new-project",
  },
  {
    target: "tabs",
    title: "Tabs and panes",
    body: "Open as many tabs as you need, and split any tab into panes.",
    shortcut: "split-horizontal",
    inWorkspace: true,
  },
  {
    target: "new-tab",
    title: "Start agents here",
    body: "New chat gives you approvals, model choice and history.",
    shortcut: "new-tab",
    opensMenu: true,
    inWorkspace: true,
  },
  {
    target: "schedules",
    title: "Schedules and pull requests",
    body: "Run agents on a schedule, and review and merge pull requests without leaving Concors.",
  },
  {
    target: "search",
    title: "Search",
    body: "Jump to any workspace or tab.",
    shortcut: "search",
    // The sidebar toggle sits under 2px away: the frame hugs the button so its ring stays clear.
    framePadding: -1,
  },
  {
    target: "machines",
    title: "This computer, or the cloud",
    body: "Your agents run on this computer. Add a cloud machine to keep them working while your laptop sleeps.",
    opensMenu: true,
  },
];

/** The steps to show: those inside a workspace only when there is one to point at. */
export function tourSteps(hasWorkspace: boolean): readonly TourStep[] {
  return hasWorkspace ? TOUR_STEPS : TOUR_STEPS.filter((step) => !step.inWorkspace);
}

export interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}
interface Size {
  readonly width: number;
  readonly height: number;
}

const GAP = 16;
const MARGIN = 12;

/**
 * A step's lit frame pulled in from the window's edges, so its ring is drawn whole even when the
 * area it frames runs to the edge of the window.
 */
export function frameInside(frame: Box, viewport: Size, inset: number): Box {
  const left = Math.max(inset, frame.left);
  const top = Math.max(inset, frame.top);
  return {
    left,
    top,
    width: Math.min(frame.left + frame.width, viewport.width - inset) - left,
    height: Math.min(frame.top + frame.height, viewport.height - inset) - top,
  };
}

/**
 * Where a step's card goes: beside a sidebar control, otherwise below the control, or above it when
 * there is no room below. Always inside the window.
 */
export function cardPosition(
  target: Box,
  card: Size,
  viewport: Size,
): { left: number; top: number } {
  const clampLeft = (left: number) =>
    Math.max(MARGIN, Math.min(left, viewport.width - card.width - MARGIN));
  const clampTop = (top: number) =>
    Math.max(MARGIN, Math.min(top, viewport.height - card.height - MARGIN));
  const right = target.left + target.width + GAP;
  if (target.left < viewport.width / 3 && right + card.width + MARGIN <= viewport.width)
    return { left: right, top: clampTop(target.top) };
  const below = target.top + target.height + GAP;
  if (below + card.height + MARGIN <= viewport.height)
    return { left: clampLeft(target.left), top: below };
  return { left: clampLeft(target.left), top: clampTop(target.top - GAP - card.height) };
}

/**
 * The welcome card's title: by first name when it has two letters or more, since a single letter
 * (an initial, or a name typed as "z") reads as a mistake rather than a greeting.
 */
export function welcomeTitle(firstName: string): string {
  const letters = firstName.match(/\p{L}/gu)?.length ?? 0;
  return letters >= 2 ? `Welcome to Concors, ${firstName}` : "Welcome to Concors";
}

/** What the person did with the tour on this device. */
export type TourOutcome = "skipped" | "completed";

/** The stored outcome, or null when the tour has not been offered on this device yet. */
export function parseTourOutcome(raw: string | null): TourOutcome | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const outcome = (value as Record<string, unknown>)["outcome"];
    return outcome === "skipped" || outcome === "completed" ? outcome : null;
  } catch {
    return null;
  }
}
