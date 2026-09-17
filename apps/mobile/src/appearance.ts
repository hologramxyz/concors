import { MobilePreferencesSchema, type MobilePreferences } from "@concors/client-core";
import { serialTasks } from "./platform/serial-task";

export const DEFAULT_APPEARANCE: MobilePreferences = {
  theme: "system",
  corners: "rounded",
  sound: false,
};
export type CornerStyle = MobilePreferences["corners"];

/** Keep these base radii aligned with the shared renderer's --corner-radius tokens. */
export function cornerRadius(corners: CornerStyle) {
  return { square: 0, subtle: 6, rounded: 12 }[corners];
}

export function nativeButtonShape(
  corners: CornerStyle,
  pill = false,
): [shape: "roundedRectangle" | "capsule" | "circle", radius?: number] {
  return corners === "rounded"
    ? [pill ? "capsule" : "circle"]
    : ["roundedRectangle", cornerRadius(corners)];
}

/** One device preference for the renderer, native glass, profile sheet and sign-in UI. */
export function createAppearanceStore(storage: {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}) {
  let value = DEFAULT_APPEARANCE;
  let changed = false;
  let hydration: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const serialize = serialTasks();
  const publish = (next: MobilePreferences) => {
    value = next;
    listeners.forEach((notify) => notify());
  };
  return {
    getSnapshot: () => value,
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    hydrate: () => {
      hydration ??= storage
        .get("appearance.v1")
        .then((raw) => {
          if (!raw || changed) return;
          const result = MobilePreferencesSchema.safeParse(JSON.parse(raw));
          if (result.success) publish(result.data);
        })
        .catch(() => {
          // Corrupt or unavailable local storage must not block the app.
        });
      return hydration;
    },
    setPreferences: (next: MobilePreferences) => {
      const parsed = MobilePreferencesSchema.parse(next);
      changed = true;
      return serialize(async () => {
        await storage.set("appearance.v1", JSON.stringify(parsed));
        publish(parsed);
      });
    },
  };
}
