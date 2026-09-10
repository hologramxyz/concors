import { expect, it } from "vitest";
import { serialTasks } from "./serial-task";
it("finishes pending registration before logout cleanup, even after a failure", async () => {
  const run = serialTasks();
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const registration = run(async () => {
    calls.push("register");
    await gate;
    throw new Error("offline");
  });
  const rejected = expect(registration).rejects.toThrow("offline");
  const cleanup = run(async () => {
    calls.push("unregister");
  });
  await Promise.resolve();
  expect(calls).toEqual(["register"]);
  release();
  await rejected;
  await cleanup;
  expect(calls).toEqual(["register", "unregister"]);
});
