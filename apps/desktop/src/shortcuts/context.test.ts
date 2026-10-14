import { expect, it, vi } from "vitest";
import { createCommands } from "./context";

it("captures an enabled action before closing a dialog unregisters its shortcut", () => {
  const commands = createCommands();
  const action = vi.fn();
  expect(commands.getAction("settings")).toBeUndefined();
  const off = commands.register("settings", action);
  const selected = commands.getAction("settings");
  off();
  expect(commands.getAction("settings")).toBeUndefined();
  commands.run("settings");
  expect(action).not.toHaveBeenCalled();
  selected?.();
  expect(action).toHaveBeenCalledTimes(1);
});

it("resolves commands in the focused pane without waiting for a render", () => {
  const commands = createCommands();
  let focused = "left";
  const left = vi.fn(),
    right = vi.fn();
  const offLeft = commands.register("start-dictation", left, () => focused === "left");
  const offRight = commands.register("start-dictation", right, () => focused === "right");
  commands.run("start-dictation");
  expect(left).toHaveBeenCalledTimes(1);
  expect(right).not.toHaveBeenCalled();
  focused = "right";
  commands.run("start-dictation");
  expect(right).toHaveBeenCalledTimes(1);
  focused = "terminal";
  expect(commands.getAction("start-dictation")).toBeUndefined();
  commands.run("start-dictation");
  expect(left).toHaveBeenCalledTimes(1);
  expect(right).toHaveBeenCalledTimes(1);
  offLeft();
  expect(commands.snapshot()).toContain("start-dictation");
  focused = "right";
  expect(commands.getAction("start-dictation")).toBe(right);
  offRight();
  expect(commands.snapshot()).not.toContain("start-dictation");
});
