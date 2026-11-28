import { describe, expect, it } from "vitest";
import type { AgentItem } from "@concors/protocol";
import {
  advanceVoice,
  CALM_LINES,
  genericLive,
  HOLD_MS,
  nextChange,
  pickLine,
  PLAYFUL_LINES,
  startVoice,
  STILL_AFTER_MS,
  STILL_WORKING,
  type Random,
} from "./live-voice";

/** A seeded source (mulberry32), so every run picks the same lines. */
function seeded(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const playful = new Set<string>(PLAYFUL_LINES);
const calm = new Set<string>(CALM_LINES);

const item = (extra: Partial<AgentItem>): AgentItem => ({
  id: "item",
  sessionId: "session",
  turnId: "turn",
  position: 0,
  revision: 0,
  kind: "tool",
  title: "Tool",
  text: "",
  detail: "",
  status: "running",
  createdAt: "2026-11-26T00:00:00.000Z",
  ...extra,
});

describe("pickLine", () => {
  it("is playful about one pick in five", () => {
    const random = seeded(42);
    let previous: string | undefined;
    let count = 0;
    const picks = 10_000;
    for (let i = 0; i < picks; i++) {
      previous = pickLine(previous, random);
      if (playful.has(previous)) count++;
      else expect(calm.has(previous)).toBe(true);
    }
    expect(count / picks).toBeGreaterThan(0.18);
    expect(count / picks).toBeLessThan(0.22);
  });

  it("never picks the same line twice in a row", () => {
    const random = seeded(7);
    let previous = pickLine(undefined, random);
    for (let i = 0; i < 5_000; i++) {
      const next = pickLine(previous, random);
      expect(next).not.toBe(previous);
      previous = next;
    }
  });

  it("follows the injected source", () => {
    // Below the playful share, then the start of the pool.
    expect(pickLine(undefined, () => 0)).toBe(PLAYFUL_LINES[0]);
    // Above it, then the end of the pool, even at a source's edge.
    expect(pickLine(undefined, () => 0.9999999)).toBe(CALM_LINES.at(-1));
    // The previous line is left out, so the same draw moves on.
    expect(pickLine(PLAYFUL_LINES[0], () => 0)).toBe(PLAYFUL_LINES[1]);
  });

  it("runs the same for the same seed and apart for another", () => {
    const run = (seed: number) => {
      const random = seeded(seed);
      return Array.from({ length: 12 }, () => pickLine(undefined, random));
    };
    expect(run(1)).toEqual(run(1));
    expect(run(1)).not.toEqual(run(2));
  });
});

describe("a wait's voice", () => {
  it("holds a line for 8 seconds, then changes it", () => {
    const random = seeded(3);
    const start = startVoice(undefined, 0, random);
    expect(start.first).toBe(start.line);
    expect(advanceVoice(start, HOLD_MS - 1, random)).toBe(start);
    const next = advanceVoice(start, HOLD_MS, random);
    expect(next.line).not.toBe(start.line);
    expect(next.since).toBe(HOLD_MS);
    // The wait keeps its first line for screen readers.
    expect(next.first).toBe(start.line);
    expect(nextChange(start)).toBe(HOLD_MS);
  });

  it("does not open a new wait on the chat's last line", () => {
    const random = seeded(11);
    for (let i = 0; i < 500; i++) {
      const previous = pickLine(undefined, random);
      expect(startVoice(previous, 0, random).line).not.toBe(previous);
    }
  });

  it("settles on Still working at 30 seconds, and stays there", () => {
    const random = seeded(5);
    let voice = startVoice(undefined, 0, random);
    const seen: string[] = [voice.line];
    for (let at = nextChange(voice); at !== undefined; at = nextChange(voice)) {
      voice = advanceVoice(voice, at, random);
      seen.push(voice.line);
      if (at < STILL_AFTER_MS) expect(voice.line).not.toBe(STILL_WORKING);
    }
    // Lines at 0, 8, 16 and 24 seconds, then the long wait's.
    expect(seen).toHaveLength(5);
    expect(seen.at(-1)).toBe(STILL_WORKING);
    expect(voice.since).toBe(STILL_AFTER_MS);
    expect(advanceVoice(voice, STILL_AFTER_MS + 60_000, random)).toBe(voice);
  });

  it("never shows a playful line after 30 seconds", () => {
    // A source that would always choose playful.
    const voice = startVoice(undefined, 0, () => 0);
    for (const at of [STILL_AFTER_MS, STILL_AFTER_MS + HOLD_MS, STILL_AFTER_MS * 3])
      expect(advanceVoice(voice, at, () => 0).line).toBe(STILL_WORKING);
  });

  it("goes to Still working even late in a line's hold", () => {
    const random = seeded(9);
    const voice = { ...startVoice(undefined, 0, random), since: 25_000 };
    expect(nextChange(voice)).toBe(STILL_AFTER_MS);
    expect(advanceVoice(voice, STILL_AFTER_MS, random).line).toBe(STILL_WORKING);
  });
});

describe("genericLive", () => {
  it("is generic with no step, or only reasoning", () => {
    expect(genericLive(undefined, undefined)).toBe(true);
    expect(genericLive(item({ presentation: { type: "thinking" } }), undefined)).toBe(true);
  });

  it("lets facts win: a step it can name, or a request it waits on", () => {
    const shell = item({ title: "Run command", presentation: { type: "shell", command: "ls" } });
    const read = item({
      title: "Read file",
      presentation: { type: "files", fileOperation: "read", files: [{ path: "a.ts", diff: "" }] },
    });
    const tool = item({ title: "concors_control", presentation: { type: "mcp", input: "{}" } });
    for (const step of [shell, read, tool]) expect(genericLive(step, undefined)).toBe(false);
    expect(genericLive(undefined, "Waiting for your approval")).toBe(false);
    expect(
      genericLive(item({ presentation: { type: "thinking" } }), "Waiting for your input"),
    ).toBe(false);
  });
});
