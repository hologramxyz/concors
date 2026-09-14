import { expect, it, vi } from "vitest";
import {
  cornerRadius,
  createAppearanceStore,
  DEFAULT_APPEARANCE,
  nativeButtonShape,
} from "./appearance";

it.each([
  ["square", 0, ["roundedRectangle", 0], ["roundedRectangle", 0]],
  ["subtle", 6, ["roundedRectangle", 6], ["roundedRectangle", 6]],
  ["rounded", 12, ["circle"], ["capsule"]],
] as const)(
  "maps %s to the same native and renderer corner geometry",
  (style, radius, icon, pill) => {
    expect(cornerRadius(style)).toBe(radius);
    expect(nativeButtonShape(style)).toEqual(icon);
    expect(nativeButtonShape(style, true)).toEqual(pill);
  },
);

it("hydrates the device preference once for every app surface", async () => {
  const preferences = { ...DEFAULT_APPEARANCE, corners: "square" } as const;
  const storage = { get: vi.fn(async () => JSON.stringify(preferences)), set: vi.fn() };
  const store = createAppearanceStore(storage);
  const notify = vi.fn();
  const unsubscribe = store.subscribe(notify);
  await Promise.all([store.hydrate(), store.hydrate()]);
  expect(storage.get).toHaveBeenCalledExactlyOnceWith("appearance.v1");
  expect(store.getSnapshot()).toEqual(preferences);
  expect(notify).toHaveBeenCalledTimes(1);
  unsubscribe();
  await store.setPreferences(DEFAULT_APPEARANCE);
  expect(notify).toHaveBeenCalledTimes(1);
});

it.each([null, "not json", '{"corners":"typo"}'])(
  "tolerates unreadable saved preferences: %s",
  async (raw) => {
    const store = createAppearanceStore({ get: async () => raw, set: vi.fn() });
    await store.hydrate();
    expect(store.getSnapshot()).toEqual(DEFAULT_APPEARANCE);
  },
);

it("does not overwrite a new selection with delayed hydration", async () => {
  let resolve!: (raw: string) => void;
  const store = createAppearanceStore({
    get: () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
    set: vi.fn(),
  });
  const loading = store.hydrate();
  const selected = { ...DEFAULT_APPEARANCE, corners: "square" } as const;
  await store.setPreferences(selected);
  resolve(JSON.stringify({ ...DEFAULT_APPEARANCE, corners: "rounded" }));
  await loading;
  expect(store.getSnapshot()).toEqual(selected);
});

it("serializes rapid changes and does not report a failed write as saved", async () => {
  let finishFirst!: () => void;
  const storage = {
    get: async () => null,
    set: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((done) => {
            finishFirst = done;
          }),
      )
      .mockRejectedValueOnce(new Error("Storage unavailable"))
      .mockResolvedValueOnce(undefined),
  };
  const store = createAppearanceStore(storage);
  const square = { ...DEFAULT_APPEARANCE, corners: "square" } as const;
  const rounded = { ...DEFAULT_APPEARANCE, corners: "rounded" } as const;
  const first = store.setPreferences(square);
  const second = store.setPreferences(rounded);
  await Promise.resolve();
  expect(storage.set).toHaveBeenCalledTimes(1);
  finishFirst();
  await first;
  await expect(second).rejects.toThrow("Storage unavailable");
  expect(store.getSnapshot()).toEqual(square);
  await store.setPreferences(rounded);
  expect(store.getSnapshot()).toEqual(rounded);
  expect(storage.set).toHaveBeenLastCalledWith("appearance.v1", JSON.stringify(rounded));
});
