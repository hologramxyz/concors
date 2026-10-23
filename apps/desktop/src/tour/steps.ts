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
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: "workspaces",
    title: "Workspaces",
    body: "Each workspace is a folder on your computer. Your agents work inside it.",
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
    body: "Choose Agent to work with Claude or Codex. Unlike a Terminal, it gives you approvals, model choice and chat history.",
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
    body: "Jump to any workspace, agent or tab from the keyboard.",
    shortcut: "search",
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
