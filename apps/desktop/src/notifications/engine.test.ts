import { afterEach, expect, it, vi } from "vitest";
import type { AgentInfo } from "@concors/protocol";
import { AttentionEngine, type NoticeSink } from "./engine";
const place = (workspace: string, tab = "") => ({ projectId: "project", workspace, tab });
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
  engine.observe(agent(), false, place("Project"));
  engine.observe(agent(), true, place("Project"));
  await vi.runAllTimersAsync();
  expect(sink.show).not.toHaveBeenCalled();
  engine.observe(agent("second"), true, place("Project"));
  engine.observe(agent("second"), true, place("Project"));
  await vi.runAllTimersAsync();
  expect(sink.show).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ title: "Agent finished in Project", body: "Codex" }),
  );
  expect(sink.sound).toHaveBeenCalledExactlyOnceWith("done");
  engine.suspend();
  engine.observe(agent("second"), false, place("Project"));
  engine.observe(agent("third"), false, place("Project"));
  engine.observe(agent("third"), true, place("Project"));
  await vi.runAllTimersAsync();
  expect(sink.show).toHaveBeenCalledTimes(1);
});
it("suppresses focused completion but plays focused input even when acknowledged immediately", async () => {
  const { sink, engine } = setup(true);
  engine.observe(agent(), true, place(""));
  await vi.runAllTimersAsync();
  expect(sink.sound).not.toHaveBeenCalled();
  engine.observe(agent("input", "needs_input"), true, place(""));
  engine.observe(agent("input", "needs_input", true), true, place(""));
  await vi.runAllTimersAsync();
  expect(sink.sound).toHaveBeenCalledExactlyOnceWith("needs_input");
  expect(sink.show).not.toHaveBeenCalled();
});
it("cancels queued alerts on remote read, new work, and disconnect", async () => {
  const { sink, engine } = setup();
  engine.observe(agent(), true, place(""));
  engine.observe(agent("first", "done", true), true, place(""));
  engine.observe(agent("second"), true, place(""));
  engine.observe({ ...agent("second"), status: "working", attention: null }, true, place(""));
  engine.observe(agent("third"), true, place(""));
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
  engine.observe(agent(), true, place(""));
  await vi.advanceTimersByTimeAsync(300);
  engine.observe({ ...agent(), status: "working", attention: null }, true, place(""));
  resolve(true);
  await vi.runAllTimersAsync();
  expect(sink.show).not.toHaveBeenCalled();
});
it("honors delivery claimed elsewhere and current preferences", async () => {
  const { sink, engine } = setup();
  sink.claim = async () => false;
  engine.observe(agent(), true, place(""));
  await vi.runAllTimersAsync();
  expect(sink.show).not.toHaveBeenCalled();
  sink.claim = async () => true;
  sink.preferences = () => ({ sound: false, desktop: false });
  engine.observe(agent("second"), true, place(""));
  await vi.runAllTimersAsync();
  expect(sink.show).not.toHaveBeenCalled();
  expect(sink.sound).not.toHaveBeenCalled();
});
it("keeps a shown notice through a reconnect without replaying it", async () => {
  const { sink, engine } = setup();
  engine.observe(agent(), true, place(""));
  await vi.runAllTimersAsync();
  expect(sink.show).toHaveBeenCalledTimes(1);
  vi.mocked(sink.clear).mockClear();
  engine.suspend();
  engine.observe(agent(), true, place(""));
  await vi.runAllTimersAsync();
  expect(sink.clear).not.toHaveBeenCalled();
  expect(sink.show).toHaveBeenCalledTimes(1);
});
it("names the workspace and tab, apart from the agent, so finished agents tell apart", async () => {
  const { sink, engine } = setup();
  engine.observe(agent(), false, place("Marketing", "Landing"));
  engine.observe(agent("second"), true, place("Marketing", "Landing"));
  await vi.runAllTimersAsync();
  expect(sink.show).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      title: "Agent finished in Marketing",
      body: "Landing · Codex",
      agent: "Codex",
      place: { projectId: "project", workspace: "Marketing", tab: "Landing" },
    }),
  );
});
