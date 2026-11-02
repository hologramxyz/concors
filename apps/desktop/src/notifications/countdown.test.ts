import { afterEach, expect, it, vi } from "vitest";
import { countdown } from "./countdown";
afterEach(() => vi.useRealTimers());
it("calls back once the whole time has run", () => {
  vi.useFakeTimers();
  const done = vi.fn();
  countdown(5000)(done);
  vi.advanceTimersByTime(4999);
  expect(done).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(done).toHaveBeenCalledOnce();
});
it("counts only the time it runs, however long it is paused", () => {
  vi.useFakeTimers();
  const done = vi.fn();
  const run = countdown(5000);
  const pause = run(done);
  vi.advanceTimersByTime(3000);
  pause();
  vi.advanceTimersByTime(60_000);
  expect(done).not.toHaveBeenCalled();
  run(done);
  vi.advanceTimersByTime(1999);
  expect(done).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(done).toHaveBeenCalledOnce();
});
it("never calls back once paused", () => {
  vi.useFakeTimers();
  const done = vi.fn();
  countdown(5000)(done)();
  vi.advanceTimersByTime(60_000);
  expect(done).not.toHaveBeenCalled();
});
