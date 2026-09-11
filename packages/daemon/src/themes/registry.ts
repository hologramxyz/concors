import { closeSync, openSync, readSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BUILTIN_THEME_IDS,
  ThemeDefinitionSchema,
  type ThemeCatalog,
  type ThemeDefinition,
} from "@concors/protocol";

const MAX_BYTES = 32 * 1024;
/** Re-read on demand, including atomic editor saves. Invalid edits retain the last valid palette. */
export class ThemeRegistry {
  private valid = new Map<string, ThemeDefinition>();
  readonly directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }
  catalog(): ThemeCatalog {
    const themes: ThemeDefinition[] = [],
      issues: ThemeCatalog["issues"] = [];
    let files: string[];
    try {
      files = readdirSync(this.directory, { withFileTypes: true })
        .filter(
          (entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."),
        )
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        issues.push({
          file: "themes",
          message: "Cannot read the theme directory. Check its permissions.",
        });
      else this.valid.clear();
      return { directory: this.directory, themes, issues };
    }
    if (files.length > 64)
      issues.push({
        file: "themes",
        message: "Only the first 64 JSON files are loaded. Remove unused themes.",
      });
    files = files.slice(0, 64);
    for (const file of this.valid.keys()) if (!files.includes(file)) this.valid.delete(file);
    const ids = new Set<string>();
    for (const file of files) {
      let fd: number | undefined;
      try {
        fd = openSync(join(this.directory, file), "r");
        const buffer = Buffer.alloc(MAX_BYTES + 1);
        let bytes = 0,
          count = 0;
        do {
          count = readSync(fd, buffer, bytes, buffer.length - bytes, null);
          bytes += count;
        } while (count && bytes < buffer.length);
        if (bytes > MAX_BYTES) throw new Error("Theme files must be 32 KiB or smaller.");
        let raw: unknown;
        try {
          raw = JSON.parse(buffer.subarray(0, bytes).toString("utf8"));
        } catch {
          throw new Error("Invalid JSON. Finish saving the file or check its syntax.");
        }
        const parsed = ThemeDefinitionSchema.safeParse(raw);
        if (!parsed.success)
          throw new Error(
            "Invalid theme. Use version 1, a name, a unique ID, and hex colors; see the theme example.",
          );
        if ((BUILTIN_THEME_IDS as readonly string[]).includes(parsed.data.id))
          throw new Error("This ID belongs to a built-in theme. Choose a unique ID.");
        this.valid.set(file, parsed.data);
      } catch (error) {
        const message =
          error instanceof Error && !("code" in error)
            ? error.message
            : "Could not read this theme file. Check its permissions.";
        issues.push({ file: file.slice(0, 255), message: message.slice(0, 500) });
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
      const theme = this.valid.get(file);
      if (theme) {
        if (ids.has(theme.id))
          issues.push({
            file: file.slice(0, 255),
            message: `Duplicate theme ID: ${theme.id}. Choose a unique ID.`,
          });
        else {
          ids.add(theme.id);
          themes.push(theme);
        }
      }
    }
    return { directory: this.directory, themes, issues: issues.slice(0, 65) };
  }
}
