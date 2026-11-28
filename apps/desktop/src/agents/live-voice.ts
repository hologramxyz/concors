import { useEffect, useRef, useState } from "react";
import type { AgentItem } from "@concors/protocol";
import { stepKind } from "./step-groups";

/**
 * What the live line says while the turn is on nothing it can name: Concors' own voice, calm and
 * now and then playful, in place of a generic "Working". Each is shown with the line's ellipsis.
 */
export const CALM_LINES = [
  "Thinking it over",
  "Working through it",
  "Getting my bearings",
  "Weighing the options",
  "Sorting out the next step",
  "Piecing it together",
  "Following the thread",
  "Mulling it over",
  "Taking a careful look",
  "Lining things up",
  "Making a plan",
  "Double-checking myself",
  "On it",
  "Give me a moment",
] as const;

/** The rare ones: about one pick in five, never once the wait runs long. */
export const PLAYFUL_LINES = [
  "Untangling the spaghetti",
  "Asking the rubber duck",
  "Consulting the semicolons",
  "Herding the brackets",
  "Sharpening the pencils",
  "Warming up the keyboard",
  "Rolling up my sleeves",
  "Putting the kettle on",
  "Stretching first",
] as const;

/** What a long wait settles on, beside its elapsed time. */
export const STILL_WORKING = "Still working";

/** The share of picks that are playful. */
export const PLAYFUL_CHANCE = 0.2;
/** How long a line holds before another may take its place. */
export const HOLD_MS = 8_000;
/** How long a wait rotates before it settles on {@link STILL_WORKING}. */
export const STILL_AFTER_MS = 30_000;

/** A source of numbers in [0, 1), `Math.random` unless a test seeds one. */
export type Random = () => number;

/**
 * The line a wait shows, when that line started, and when the wait did. `first` is the wait's
 * opening line, the only one a screen reader is told, so it does not hear every rotation.
 */
export interface Voice {
  line: string;
  first: string;
  since: number;
  waitStart: number;
}

/** A new line: playful about one time in five, never `previous` again. */
export function pickLine(previous: string | undefined, random: Random): string {
  const pool: readonly string[] = random() < PLAYFUL_CHANCE ? PLAYFUL_LINES : CALM_LINES;
  const options = pool.filter((line) => line !== previous);
  return (
    options[Math.min(options.length - 1, Math.floor(random() * options.length))] ?? CALM_LINES[0]
  );
}

/** A wait beginning at `now`, after a chat last said `previous`. */
export function startVoice(previous: string | undefined, now: number, random: Random): Voice {
  const line = pickLine(previous, random);
  return { line, first: line, since: now, waitStart: now };
}

/** The voice at `now`: the same line within its hold, another after it, and then the long wait's. */
export function advanceVoice(voice: Voice, now: number, random: Random): Voice {
  if (now - voice.waitStart >= STILL_AFTER_MS)
    return voice.line === STILL_WORKING ? voice : { ...voice, line: STILL_WORKING, since: now };
  if (now - voice.since >= HOLD_MS)
    return { ...voice, line: pickLine(voice.line, random), since: now };
  return voice;
}

/** When the voice next changes, or undefined once it has settled. */
export function nextChange(voice: Voice): number | undefined {
  if (voice.line === STILL_WORKING) return undefined;
  return Math.min(voice.since + HOLD_MS, voice.waitStart + STILL_AFTER_MS);
}

/**
 * Whether the live line has nothing specific to say: no request it waits on, and no step, or only
 * reasoning, which it can name no better than "Thinking". Anything else is a fact and wins.
 */
export function genericLive(step: AgentItem | undefined, waiting: string | undefined): boolean {
  if (waiting) return false;
  return !step || stepKind(step) === "thinking";
}

interface VoiceState {
  voice: Voice | null;
  /** The chat's last line, which its next wait does not open on. */
  last: string | undefined;
  /** Counts the chat's waits, so a timer from an earlier one changes nothing. */
  wait: number;
}

/**
 * The chat's voice for its live line while `generic`, else undefined. One per chat, so chats pick
 * on their own; the chat keeps its last line across waits, so a new wait never opens on it again.
 * A wait's clock starts at 0 when it begins; its effect pins that to the wall clock.
 */
export function useLiveVoice(generic: boolean, random: Random = Math.random): Voice | undefined {
  const [state, setState] = useState<VoiceState>(() => ({
    voice: generic ? startVoice(undefined, 0, random) : null,
    last: undefined,
    wait: 0,
  }));
  // Starting and ending a wait follow the render that changes `generic`, so no frame shows another line.
  if (generic && !state.voice)
    setState({ voice: startVoice(state.last, 0, random), last: state.last, wait: state.wait + 1 });
  if (!generic && state.voice) setState({ ...state, voice: null, last: state.voice.line });
  const voice = generic ? state.voice : null;
  const { wait } = state;
  const origin = useRef<{ wait: number; at: number } | null>(null);
  useEffect(() => {
    if (!voice) return;
    if (origin.current?.wait !== wait) origin.current = { wait, at: Date.now() };
    const start = origin.current.at;
    const at = nextChange(voice);
    if (at === undefined) return;
    const timer = setTimeout(
      () =>
        setState((current) =>
          current.voice && current.wait === wait
            ? { ...current, voice: advanceVoice(current.voice, Date.now() - start, random) }
            : current,
        ),
      Math.max(0, start + at - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [voice, wait, random]);
  return voice ?? undefined;
}
