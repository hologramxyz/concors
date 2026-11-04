import { beforeEach, expect, it, vi } from "vitest";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
});

/** The module as a fresh launch of the app finds it. */
async function launch() {
  vi.resetModules();
  return import("./dismissed-account-prompts");
}

beforeEach(() => storage.clear());

it("remembers a dismissed sign-in across restarts, until it is cleared", async () => {
  const first = await launch();
  first.setAccountPromptDismissed("machine:claude", true);
  expect(first.isAccountPromptDismissed("machine:claude")).toBe(true);
  expect(first.isAccountPromptDismissed("machine:codex")).toBe(false);

  const second = await launch();
  expect(second.isAccountPromptDismissed("machine:claude")).toBe(true);
  second.setAccountPromptDismissed("machine:claude", false);
  expect(second.isAccountPromptDismissed("machine:claude")).toBe(false);

  expect((await launch()).isAccountPromptDismissed("machine:claude")).toBe(false);
});

it("forgets a dismissal for now at the next restart, and clearing it works before then", async () => {
  const first = await launch();
  first.dismissAccountPromptForNow("machine:codex");
  expect(first.isAccountPromptDismissed("machine:codex")).toBe(true);
  expect((await launch()).isAccountPromptDismissed("machine:codex")).toBe(false);

  const second = await launch();
  second.dismissAccountPromptForNow("machine:codex");
  second.setAccountPromptDismissed("machine:codex", false);
  expect(second.isAccountPromptDismissed("machine:codex")).toBe(false);
});

it("does not downgrade a remembered dismissal to one for now", async () => {
  const first = await launch();
  first.setAccountPromptDismissed("machine:claude", true);
  first.dismissAccountPromptForNow("machine:claude");
  expect((await launch()).isAccountPromptDismissed("machine:claude")).toBe(true);
});

it("survives storage that cannot be written, for this launch", async () => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {
      throw new Error("Storage is full");
    },
  });
  const app = await launch();
  app.setAccountPromptDismissed("machine:claude", true);
  expect(app.isAccountPromptDismissed("machine:claude")).toBe(true);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
