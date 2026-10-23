import { useSyncExternalStore } from "react";
import { parseTourOutcome, type TourOutcome } from "./steps";

/** Whether the tour has run on this device, kept like keyboard shortcuts: per device, never reported. */
export const TOUR_KEY = "concors.tour";

interface TourSnapshot {
  readonly outcome: TourOutcome | null;
  /** Bumped by `replayTour`, so an open window starts the tour again. */
  readonly replays: number;
}

const listeners = new Set<() => void>();
let replays = 0;
// Without storage, a skipped tour stays skipped until the app reloads.
let fallback: string | null = null;
// useSyncExternalStore compares snapshots by identity.
let snapshot: TourSnapshot = { outcome: null, replays: 0 };

function read(): TourSnapshot {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(TOUR_KEY);
  } catch {
    raw = fallback;
  }
  const outcome = parseTourOutcome(raw);
  if (outcome !== snapshot.outcome || replays !== snapshot.replays) snapshot = { outcome, replays };
  return snapshot;
}

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === TOUR_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTour(): TourSnapshot {
  return useSyncExternalStore(subscribe, read, () => snapshot);
}

export function finishTour(outcome: TourOutcome) {
  const raw = JSON.stringify({ outcome });
  fallback = raw;
  try {
    window.localStorage.setItem(TOUR_KEY, raw);
  } catch {
    /* Kept in memory instead; see `fallback`. */
  }
  notify();
}

export function replayTour() {
  replays += 1;
  notify();
}
