import { afterEach, expect, it, vi } from "vitest";
import type { AgentInfo } from "@concors/protocol";
import { AttentionEngine, type NoticeSink } from "./engine";
const agent = (id = "first", kind: "done" | "needs_input" = "done", seen = false): AgentInfo => ({
  id: "session",
  projectId: "project",
  provider: "codex",
  name: "Codex",
  directory: "/repo",
  model: null,
  threadId: "thread",
  turnId: "turn",
  status: kind,
  error: null,
  startedAt: "",
  updatedAt: "",
  turnStartedAt: null,
  revision: 1,
  pending: [],
  attention: { id, kind, seen, createdAt: "" },
});
function setup(focused = false) {
  vi.useFakeTimers();
  const sink: NoticeSink = {
    claim: vi.fn(async () => true),
    sound: vi.fn(),
    show: vi.fn(),
    clear: vi.fn(),
    focused: vi.fn(() => focused),
    preferences: () => ({ sound: true, desktop: true }),
  };
  return { sink, engine: new AttentionEngine(sink) };
}
afterEach(() => vi.useRealTimers());
it("baselines snapshots, delivers a new attention once, and does not replay on reconnect", async () => {
  const { sink, engine } = setup();
  engine.observe(agent(), false, "Project");
  engine.observe(agent(), true, "Project");
  await vi.runAllTimersAsync();
  expect(sink.show).not.toHaveBeenCalled();
  engine.observe(agent("second"), true, "Project");
  engine.observe(agent("second"), true, "Project");
  await vi.runAllTimersAsync();
  expect(sink.show).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ body: "Project · Codex" }),
  );
  expect(sink.sound).toHaveBeenCalledExactlyOnceWith("done");
  engine.suspend();
  engine.observe(agent("second"), false, "Project");
  engine.observe(agent("third"), false, "Project");
  engine.observe(agent("third"), true, "Project");
  await vi.runAllTimersAsync();
  expect(sink.show).toHaveBeenCalledTimes(1);
});
it("suppresses focused completion but plays focused input even when acknowledged immediately", async () => {
  const { sink, engine } = setup(true);
  engine.observe(agent(), true, "");
  await vi.runAllTimersAsync();
  expect(sink.sound).not.toHaveBeenCalled();
  engine.observe(agent("input", "needs_input"), true, "");
  engine.observe(agent("input", "needs_input", true), true, "");
  await vi.runAllTimersAsync();
  expect(sink.sound).toHaveBeenCalledExactlyOnceWith("needs_input");
  expect(sink.show).not.toHaveBeenCalled();
});
it("cancels queued alerts on remote read, new work, and disconnect", async () => {
  const { sink, engine } = setup();
  engine.observe(agent(), true, "");
  engine.observe(agent("first", "done", true), true, "");
  engine.observe(agent("second"), true, "");
  engine.observe({ ...agent("second"), status: "working", attention: null }, true, "");
  engine.observe(agent("third"), true, "");
  engine.suspend();
  await vi.runAllTimersAsync();
  expect(sink.show).not.toHaveBeenCalled();
  expect(sink.sound).not.toHaveBeenCalled();
  expect(sink.clear).toHaveBeenCalledWith("session");
});
it("rechecks attention after acquiring the cross-window delivery lock", async () => {
  const { sink, engine } = setup();
  let resolve!: (value: boolean) => void;
  sink.claim = () =>
    new Promise((r) => {
      resolve = r;
    });
  engine.observe(agent(), true, "");
  await vi.advanceTimersByTimeAsync(300);
  engine.observe({ ...agent(), status: "working", attention: null }, true, "");
  resolve(true);
  await vi.runAllTimersAsync();
  expect(sink.show).not.toHaveBeenCalled();
});
it("honors delivery claimed elsewhere and current preferences", async () => {
  const { sink, engine } = setup();
  sink.claim = async () => false;
  engine.observe(agent(), true, "");
  await vi.runAllTimersAsync();
  expect(sink.show).not.toHaveBeenCalled();
  sink.claim = async () => true;
  sink.preferences = () => ({ sound: false, desktop: false });
  engine.observe(agent("second"), true, "");
  await vi.runAllTimersAsync();
  expect(sink.show).not.toHaveBeenCalled();
  expect(sink.sound).not.toHaveBeenCalled();
});
