import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ThemeRegistry } from "./registry.ts";

it("loads agent-written files, handles atomic edits, retains valid colors during errors and removes deleted themes", () => {
  const root = mkdtempSync(join(tmpdir(), "concors-themes-")),
    directory = join(root, "themes");
  const registry = new ThemeRegistry(directory);
  const definition = {
    version: 1,
    id: "custom-blue",
    name: "Custom blue",
    extends: "cobalt",
    dark: { accent: "#aaccff" },
  };
  try {
    expect(registry.catalog().themes).toEqual([]);
    mkdirSync(directory);
    const file = join(directory, "blue.json");
    writeFileSync(file, JSON.stringify(definition));
    expect(registry.catalog().themes[0]?.name).toBe("Custom blue");
    writeFileSync(join(directory, "edit.tmp"), JSON.stringify({ ...definition, name: "Blue sky" }));
    renameSync(join(directory, "edit.tmp"), file);
    expect(registry.catalog().themes[0]?.name).toBe("Blue sky");
    writeFileSync(file, '{"unfinished":');
    expect(registry.catalog()).toMatchObject({
      themes: [{ name: "Blue sky" }],
      issues: [{ file: "blue.json" }],
    });
    writeFileSync(
      file,
      JSON.stringify({ ...definition, dark: { accent: "url(https://example.test)" } }),
    );
    expect(registry.catalog().themes[0]?.name).toBe("Blue sky");
    rmSync(file);
    expect(registry.catalog()).toMatchObject({ themes: [], issues: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("bounds files and rejects duplicate or reserved IDs without hiding valid themes", () => {
  const root = mkdtempSync(join(tmpdir(), "concors-themes-"));
  try {
    const theme = { version: 1, id: "sample", name: "Sample" };
    writeFileSync(join(root, "a.json"), JSON.stringify(theme));
    writeFileSync(join(root, "b.json"), JSON.stringify(theme));
    writeFileSync(join(root, "c.json"), JSON.stringify({ ...theme, id: "concors" }));
    writeFileSync(join(root, "large.json"), " ".repeat(32769));
    const catalog = new ThemeRegistry(root).catalog();
    expect(catalog.themes).toHaveLength(1);
    expect(catalog.issues.map((issue) => issue.file)).toEqual(["b.json", "c.json", "large.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
