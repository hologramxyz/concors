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
