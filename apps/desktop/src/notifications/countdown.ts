/**
 * Time that passes only while it runs. An in-app card counts its few seconds only while someone
 * can read it, so one that arrived while the window was behind another app is still there when
 * they come back, and one under the pointer does not vanish just before the click.
 */
export function countdown(ms: number) {
  let remaining = ms;
  /** Runs out the rest of the time, then calls `done`; the returned function pauses it there. */
  return (done: () => void): (() => void) => {
    const started = Date.now();
    const timer = setTimeout(done, remaining);
    return () => {
      clearTimeout(timer);
      remaining = Math.max(0, remaining - (Date.now() - started));
    };
  };
}
