import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

const source = readFileSync(
  new URL("../../public/assets/startup-appearance.js", import.meta.url),
  "utf8",
);
function boot(values: Record<string, string>, systemDark = false, blocked = false) {
  const classes = new Set<string>();
  const properties = new Map<string, string>();
  const root = {
    classList: {
      toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
    },
    style: {
      colorScheme: "",
      setProperty: (name: string, value: string) => properties.set(name, value),
    },
  };
  runInNewContext(source, {
    localStorage: {
      getItem: (key: string) => {
        if (blocked) throw new Error("Storage unavailable");
        return values[key] ?? null;
      },
    },
    matchMedia: () => ({ matches: systemDark }),
    document: { documentElement: root },
  });
  return { classes, properties, mode: root.style.colorScheme };
}
it("honors a saved mode before the app loads, with system fallback when storage is unavailable", () => {
  expect(boot({ "concors.theme": "dark" }).mode).toBe("dark");
  expect(boot({ "concors.theme": "light" }, true).classes.has("dark")).toBe(false);
  expect(boot({}, true, true).mode).toBe("dark");
  expect(boot({ "concors.theme": "corrupt" }, false).mode).toBe("light");
});
it("restores only colors belonging to the currently selected theme and mode", () => {
  const values = {
    "concors.theme": "dark",
    "concors.color-theme": JSON.stringify({ id: "ocean" }),
    "concors.startup-appearance.v1": JSON.stringify({
      id: "ocean",
      mode: "dark",
      background: "#112233",
      foreground: "#eeeeee",
    }),
  };
  expect(boot(values).properties.get("--startup-background")).toBe("#112233");
  expect(boot({ ...values, "concors.theme": "light" }).properties.size).toBe(0);
  expect(
    boot({ ...values, "concors.color-theme": JSON.stringify({ id: "rose" }) }).properties.size,
  ).toBe(0);
});
it("ignores malformed cache entries and non-color values without breaking startup", () => {
  for (const cached of [
    "{broken",
    "null",
    JSON.stringify({
      id: "concors",
      mode: "light",
      background: "url(https://invalid.example)",
      foreground: "#112233",
    }),
  ])
    expect(boot({ "concors.startup-appearance.v1": cached }).properties.size).toBe(0);
});
