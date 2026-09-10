import { expect, it, vi } from "vitest";
import { MachineCredentialStore } from "./machine-credential-store.ts";

it("serializes logout after a pending secure write and rejects late mints", async () => {
  let finish!: () => void;
  let value: string | null = null;
  const write = vi.fn(async (next: string | null) => {
    if (next)
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    value = next;
  });
  const store = new MachineCredentialStore({ read: async () => value, write });
  const old = store.begin("account:org", "machine");
  const saving = old.save("old-token");
  await Promise.resolve();
  const clearing = store.clear();
  finish();
  await Promise.all([saving, clearing]);
  await old.save("late-token");
  expect(value).toBeNull();
  expect(write).toHaveBeenCalledTimes(2);
});
it("a superseded connection cannot clear the next account's credential", async () => {
  let value: string | null = null;
  const store = new MachineCredentialStore({
    read: async () => value,
    write: async (next) => {
      value = next;
    },
  });
  const old = store.begin("old:org", "machine");
  const current = store.begin("new:org", "machine");
  await current.save("current-token");
  await old.clear();
  await old.save("stale-token");
  expect(JSON.parse(value!)).toEqual({
    scope: "new:org",
    machineId: "machine",
    token: "current-token",
  });
  await current.clear();
  expect(value).toBeNull();
});
