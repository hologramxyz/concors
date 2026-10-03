import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import type * as NodeFs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { shareClaudeHome, UNSHARED_DIRECTORY } from "./claude-home.ts";

// Windows without Developer Mode refuses file symlinks; some filesystems refuse hard links too.
const refuse = vi.hoisted(() => ({ fileSymlinks: false, hardLinks: false }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof NodeFs>();
  const denied = (syscall: string) =>
    Object.assign(new Error(`EPERM: operation not permitted, ${syscall}`), { code: "EPERM" });
  return {
    ...fs,
    symlinkSync: (...args: Parameters<typeof fs.symlinkSync>) => {
      if (refuse.fileSymlinks && args[2] === "file") throw denied("symlink");
      return fs.symlinkSync(...args);
    },
    linkSync: (...args: Parameters<typeof fs.linkSync>) => {
      if (refuse.hardLinks) throw denied("link");
      return fs.linkSync(...args);
    },
  };
});

const directories: string[] = [];
afterEach(async () => {
  refuse.fileSymlinks = refuse.hardLinks = false;
  await Promise.all(directories.map((p) => rm(p, { recursive: true, force: true })));
  directories.length = 0;
});
async function homes() {
  const root = await mkdtemp(join(tmpdir(), "concors-claude-home-"));
  directories.push(root);
  const shared = join(root, "machine");
  const home = join(root, "account");
  await mkdir(home, { recursive: true });
  return { shared, home };
}
const isLink = async (path: string) => (await lstat(path)).isSymbolicLink();

it("links a new account's history and setup to the machine's Claude directory", async () => {
  const { shared, home } = await homes();
  await mkdir(shared, { recursive: true });
  await writeFile(join(shared, "settings.json"), '{"theme":"dark"}');
  await writeFile(join(home, ".credentials.json"), "account secret");

  shareClaudeHome(home, shared);

  expect(await isLink(join(home, "projects"))).toBe(true);
  expect(await readlink(join(home, "projects"))).toBe(join(shared, "projects"));
  expect(await readFile(join(home, "settings.json"), "utf8")).toBe('{"theme":"dark"}');
  // The sign-in, the account's state and plugins stay the account's own.
  expect(await isLink(join(home, ".credentials.json"))).toBe(false);
  await expect(lstat(join(home, "plugins"))).rejects.toThrow();
  await expect(lstat(join(shared, ".credentials.json"))).rejects.toThrow();
  // A file neither side has yet is left for Claude to create.
  await expect(lstat(join(home, "CLAUDE.md"))).rejects.toThrow();

  // A transcript written under one account is where every other account looks.
  await writeFile(join(home, "projects", "chat.jsonl"), "{}\n");
  expect(await readdir(join(shared, "projects"))).toEqual(["chat.jsonl"]);
});

it("moves an account's existing transcripts into the shared history", async () => {
  const { shared, home } = await homes();
  await mkdir(join(shared, "projects", "-repo", "memory"), { recursive: true });
  await writeFile(join(shared, "projects", "-repo", "default.jsonl"), "machine\n");
  await writeFile(join(shared, "projects", "-repo", "memory", "MEMORY.md"), "machine memory");
  await mkdir(join(home, "projects", "-repo", "memory"), { recursive: true });
  await mkdir(join(home, "projects", "-other"), { recursive: true });
  await writeFile(join(home, "projects", "-repo", "work.jsonl"), "work\n");
  await writeFile(join(home, "projects", "-other", "side.jsonl"), "side\n");
  await writeFile(join(home, "projects", "-repo", "memory", "MEMORY.md"), "account memory");
  await writeFile(join(shared, "history.jsonl"), '{"display":"one"}');
  await writeFile(join(home, "history.jsonl"), '{"display":"two"}\n');
  await writeFile(join(shared, "settings.json"), "machine settings");
  await writeFile(join(home, "settings.json"), "account settings");
  await writeFile(join(home, "CLAUDE.md"), "account instructions");

  shareClaudeHome(home, shared);

  expect((await readdir(join(shared, "projects", "-repo"))).sort()).toEqual([
    "default.jsonl",
    "memory",
    "work.jsonl",
  ]);
  expect(await readFile(join(shared, "projects", "-other", "side.jsonl"), "utf8")).toBe("side\n");
  expect(await readFile(join(home, "projects", "-repo", "work.jsonl"), "utf8")).toBe("work\n");
  // Prompt history from both sides survives; other conflicts keep the machine's copy.
  expect(await readFile(join(shared, "history.jsonl"), "utf8")).toBe(
    '{"display":"one"}\n{"display":"two"}\n',
  );
  expect(await readFile(join(home, "settings.json"), "utf8")).toBe("machine settings");
  expect(await readFile(join(shared, "projects", "-repo", "memory", "MEMORY.md"), "utf8")).toBe(
    "machine memory",
  );
  // A file only the account had becomes the machine's.
  expect(await readFile(join(shared, "CLAUDE.md"), "utf8")).toBe("account instructions");

  // Nothing the account had is lost: what lost a conflict is set aside in its own directory.
  const [run] = await readdir(join(home, UNSHARED_DIRECTORY));
  const aside = join(home, UNSHARED_DIRECTORY, run ?? "");
  expect(await readFile(join(aside, "settings.json"), "utf8")).toBe("account settings");
  expect(await readFile(join(aside, "projects", "-repo", "memory", "MEMORY.md"), "utf8")).toBe(
    "account memory",
  );
});

it("is idempotent and leaves links the person made alone", async () => {
  const { shared, home } = await homes();
  const elsewhere = join(home, "..", "elsewhere");
  await mkdir(elsewhere, { recursive: true });
  await symlink(elsewhere, join(home, "skills"));

  shareClaudeHome(home, shared);
  shareClaudeHome(home, shared);

  expect(await readlink(join(home, "skills"))).toBe(elsewhere);
  expect(await readlink(join(home, "projects"))).toBe(join(shared, "projects"));
  await expect(lstat(join(home, UNSHARED_DIRECTORY))).rejects.toThrow();
});

it("does nothing when the account already is the machine's directory", async () => {
  const { shared } = await homes();
  await mkdir(join(shared, "projects"), { recursive: true });
  shareClaudeHome(shared, shared);
  expect(await isLink(join(shared, "projects"))).toBe(false);
});

/** Both paths name one file, as a hard link leaves them. */
const sameFile = async (a: string, b: string) =>
  (await stat(a, { bigint: true })).ino === (await stat(b, { bigint: true })).ino;

async function populated() {
  const { shared, home } = await homes();
  await mkdir(shared, { recursive: true });
  await writeFile(join(shared, "settings.json"), "machine settings");
  await writeFile(join(shared, "history.jsonl"), '{"display":"one"}\n');
  await writeFile(join(home, "settings.json"), "account settings");
  await writeFile(join(home, "history.jsonl"), '{"display":"two"}\n');
  await writeFile(join(home, "CLAUDE.md"), "account instructions");
  return { shared, home };
}

it("hard-links files where symlinks are refused, and later launches change nothing", async () => {
  refuse.fileSymlinks = true;
  const { shared, home } = await populated();

  for (let launch = 0; launch < 3; launch++) shareClaudeHome(home, shared);

  for (const name of ["settings.json", "history.jsonl", "CLAUDE.md"])
    expect(await sameFile(join(home, name), join(shared, name))).toBe(true);
  expect(await readFile(join(home, "settings.json"), "utf8")).toBe("machine settings");
  expect(await readFile(join(home, "CLAUDE.md"), "utf8")).toBe("account instructions");
  expect(await readFile(join(home, "history.jsonl"), "utf8")).toBe(
    '{"display":"one"}\n{"display":"two"}\n',
  );
  // Directories are still linked, and the one conflict was set aside once, not once per launch.
  expect(await isLink(join(home, "projects"))).toBe(true);
  const runs = await readdir(join(home, UNSHARED_DIRECTORY));
  expect(runs).toHaveLength(1);
  const aside = join(home, UNSHARED_DIRECTORY, runs[0] ?? "");
  expect(await readFile(join(aside, "settings.json"), "utf8")).toBe("account settings");
  // An edit on either side is the other side's too.
  await writeFile(join(home, "CLAUDE.md"), "edited in the account");
  expect(await readFile(join(shared, "CLAUDE.md"), "utf8")).toBe("edited in the account");
});

it("leaves an account's files in place when no link can be made", async () => {
  refuse.fileSymlinks = refuse.hardLinks = true;
  const { shared, home } = await populated();

  for (let launch = 0; launch < 3; launch++) shareClaudeHome(home, shared);

  expect(await readFile(join(home, "settings.json"), "utf8")).toBe("account settings");
  expect(await readFile(join(home, "history.jsonl"), "utf8")).toBe('{"display":"two"}\n');
  expect(await readFile(join(home, "CLAUDE.md"), "utf8")).toBe("account instructions");
  expect(await readFile(join(shared, "settings.json"), "utf8")).toBe("machine settings");
  expect(await readFile(join(shared, "history.jsonl"), "utf8")).toBe('{"display":"one"}\n');
  await expect(lstat(join(shared, "CLAUDE.md"))).rejects.toThrow();
  await expect(lstat(join(home, UNSHARED_DIRECTORY))).rejects.toThrow();
  expect((await readdir(home)).filter((name) => name.startsWith(".concors-link"))).toEqual([]);
  expect(await isLink(join(home, "projects"))).toBe(true);
});
