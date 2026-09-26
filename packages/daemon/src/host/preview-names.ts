import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { PREVIEW_NAME_MAX } from "@concors/protocol";

/** The environment variable an agent sets on a dev server's command to name its preview. */
export const PREVIEW_NAME_VARIABLE = "CONCORS_PREVIEW_NAME";

const LIMIT = 256;

/** Printable, single-line and short enough for the sidebar; empty when nothing is left. */
export function cleanPreviewName(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .trim()
      .slice(0, PREVIEW_NAME_MAX)
      .trim()
  );
}

/** The name an agent gave the server in its environment (`/proc/<pid>/environ`), if any. */
export function environmentPreviewName(environ: string): string | undefined {
  const prefix = `${PREVIEW_NAME_VARIABLE}=`;
  const entry = environ.split("\0").find((item) => item.startsWith(prefix));
  return entry ? cleanPreviewName(entry.slice(prefix.length)) || undefined : undefined;
}

/**
 * Names people gave previews, kept across restarts. A dev server gets a new process every time
 * it restarts, so a name belongs to the server's working directory and port instead.
 */
export class PreviewNames {
  readonly #path: string | null;
  #names: Record<string, string>;
  constructor(path: string | null) {
    this.#path = path;
    this.#names = {};
    if (!path) return;
    try {
      const saved: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (saved && typeof saved === "object")
        for (const [key, value] of Object.entries(saved))
          if (typeof value === "string" && cleanPreviewName(value))
            this.#names[key] = cleanPreviewName(value);
    } catch {
      // No names saved yet, or an unreadable file: previews fall back to their other names.
    }
  }
  get(directory: string | null, port: number): string | undefined {
    return this.#names[key(directory, port)];
  }
  set(directory: string | null, port: number, name: string): void {
    const { [key(directory, port)]: _, ...rest } = this.#names;
    const clean = cleanPreviewName(name);
    // Oldest names go first once the file is full; insertion order is the age.
    this.#names = clean
      ? Object.fromEntries([...Object.entries(rest), [key(directory, port), clean]].slice(-LIMIT))
      : rest;
    if (!this.#path) return;
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 });
    const temp = `${this.#path}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.#names, null, 2), { mode: 0o600 });
    renameSync(temp, this.#path);
  }
}

function key(directory: string | null, port: number) {
  return `${port} ${directory ?? ""}`;
}
