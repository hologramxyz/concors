import {
  appendFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  type Stats,
} from "node:fs";
import { join, resolve } from "node:path";

/**
 * Claude Code keeps everything under one directory, `CLAUDE_CONFIG_DIR`: the sign-in, but also
 * every conversation transcript and the person's own setup. A subscription needs a directory of
 * its own for the sign-in, and on its own that also gave each account its own history, so a chat
 * started on one account could not be resumed after switching to another, and every account
 * started without the person's settings, skills and commands.
 *
 * So a subscription's directory links the parts that belong to the person rather than to the
 * account to the machine's own Claude directory (normally `~/.claude`), which the default account
 * uses directly. What stays apart is the sign-in (`.credentials.json`), the account's state
 * (`.claude.json`) and plugins: Claude Code records a plugin by the absolute path it was installed
 * under and refuses a marketplace recorded under another directory, so a shared plugin directory
 * breaks in every account but the one that installed it.
 *
 * Everything here is best effort. An entry that cannot be linked (a filesystem without symlinks,
 * a permission problem) leaves that account on its own copy, as before.
 */

/** Created in the machine's directory when missing, so a new account never starts its own. */
const SHARED_DIRECTORIES = [
  "projects",
  "file-history",
  "todos",
  "plans",
  "agents",
  "commands",
  "skills",
  "output-styles",
  "rules",
];
/** Linked once either side has one; until then Claude creates it here and the next launch moves it. */
const SHARED_FILES = ["settings.json", "CLAUDE.md", "keybindings.json", "history.jsonl"];
/** Prompt history from both sides is worth keeping; for the rest the machine's copy wins. */
const APPENDABLE = new Set(["history.jsonl"]);
/** Where an account's own copy goes when the machine already has a different one. */
export const UNSHARED_DIRECTORY = ".concors-unshared";

/** Links `home`'s person-level entries to `shared`, moving anything already in `home` across. */
export function shareClaudeHome(home: string, shared: string): void {
  if (resolve(home) === resolve(shared)) return;
  // One folder per run, so a later migration never overwrites what an earlier one set aside.
  const aside = join(home, UNSHARED_DIRECTORY, new Date().toISOString().replace(/[:.]/g, "-"));
  for (const name of SHARED_DIRECTORIES) attempt(() => share(home, shared, name, true, aside));
  for (const name of SHARED_FILES) attempt(() => share(home, shared, name, false, aside));
}

function share(home: string, shared: string, name: string, directory: boolean, aside: string) {
  const link = join(home, name);
  const target = join(shared, name);
  const current = lstat(link);
  // Already linked, by Concors or deliberately by the person; either way it is left alone.
  if (current?.isSymbolicLink()) return;
  if (directory) mkdirSync(target, { recursive: true, mode: 0o700 });
  else if (!lstat(target)) {
    if (!current) return;
    mkdirSync(shared, { recursive: true, mode: 0o700 });
    move(link, target);
  }
  if (lstat(link)) {
    const existing = lstat(target);
    if (directory && current?.isDirectory() && existing?.isDirectory())
      mergeDirectory(link, target, join(aside, name));
    else if (!directory && current?.isFile() && APPENDABLE.has(name)) appendFile(link, target);
    else setAside(link, join(aside, name));
  }
  symlinkSync(target, link, directory ? "junction" : "file");
}

/** Moves every entry across; a name the machine already has keeps the machine's copy. */
function mergeDirectory(source: string, target: string, aside: string) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    const existing = lstat(to);
    if (!existing) move(from, to);
    else if (entry.isDirectory() && existing.isDirectory())
      mergeDirectory(from, to, join(aside, entry.name));
    else setAside(from, join(aside, entry.name));
  }
  rmdirSync(source);
}

function appendFile(source: string, target: string) {
  const content = readFileSync(source);
  if (content.length) {
    const existing = readFileSync(target);
    const separator = existing.length && existing.at(-1) !== 0x0a ? "\n" : "";
    appendFileSync(target, Buffer.concat([Buffer.from(separator), content]));
  }
  unlinkSync(source);
}

function setAside(path: string, aside: string) {
  mkdirSync(resolve(aside, ".."), { recursive: true, mode: 0o700 });
  move(path, aside);
}

/** A rename, or a copy when the two directories are on different filesystems. */
function move(from: string, to: string) {
  try {
    renameSync(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    cpSync(from, to, {
      recursive: true,
      preserveTimestamps: true,
      force: false,
      errorOnExist: true,
    });
    rmSync(from, { recursive: true, force: true });
  }
}

function lstat(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function attempt(step: () => void) {
  try {
    step();
  } catch {
    // Best effort: an entry that cannot be shared stays the account's own, which still works.
  }
}
