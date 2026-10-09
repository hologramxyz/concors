import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  compareVersions,
  parseVersion,
  ProviderVersions,
  updateCommand,
  type VersionTarget,
} from "./versions.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.map((p) => rm(p, { recursive: true, force: true })));
  directories.length = 0;
});

it("reads versions from each CLI's --version output", () => {
  expect(parseVersion("codex-cli 0.154.0\n")).toBe("0.154.0");
  expect(parseVersion("2.1.280 (Claude Code)")).toBe("2.1.280");
  expect(parseVersion("1.18.30")).toBe("1.18.30");
  expect(parseVersion("pi v0.85.1-beta.2")).toBe("0.85.1-beta.2");
  expect(parseVersion("no version here")).toBeUndefined();
});

it("orders releases numerically and prereleases before their release", () => {
  expect(compareVersions("0.156.0", "0.154.0")).toBe(1);
  expect(compareVersions("2.1.280", "2.1.99")).toBe(1);
  expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  expect(compareVersions("1.0.0-beta.2", "1.0.0")).toBe(-1);
  expect(compareVersions("1.0.0-beta.10", "1.0.0-beta.2")).toBe(1);
});

it("only offers an update command scoped to the install that owns the CLI", () => {
  const base = {
    engine: "codex",
    package: "@openai/codex",
    command: "/usr/bin/codex",
    prefix: "/home/me/.concors/providers/codex",
  };
  expect(
    updateCommand({
      ...base,
      path: "/home/me/.concors/providers/codex/node_modules/@openai/codex/bin/codex.js",
    }),
  ).toEqual([
    "npm",
    "install",
    "--prefix",
    base.prefix,
    "--no-audit",
    "--no-fund",
    "--save-exact",
    "@openai/codex@latest",
  ]);
  expect(
    updateCommand({ ...base, path: "/home/me/.local/share/mise/installs/codex/0.154.0/bin/codex" }),
  ).toEqual(["mise", "upgrade", "codex"]);
  // A global npm install under mise's node belongs to npm, not to a mise tool.
  expect(
    updateCommand({
      ...base,
      path: "/home/me/.local/share/mise/installs/node/24.1.0/lib/node_modules/@openai/codex/bin/codex.js",
    }),
  ).toEqual([
    "npm",
    "install",
    "--global",
    "--prefix",
    "/home/me/.local/share/mise/installs/node/24.1.0",
    "--no-audit",
    "--no-fund",
    "@openai/codex@latest",
  ]);
  // Backend-qualified mise tools have encoded directory names `mise upgrade` rejects.
  expect(
    updateCommand({
      ...base,
      path: "/home/me/.local/share/mise/installs/npm-openai-codex/0.154.0/bin/codex",
    }),
  ).toBeUndefined();
  expect(updateCommand({ ...base, path: "/opt/homebrew/Cellar/codex/0.154.0/bin/codex" })).toEqual([
    "brew",
    "upgrade",
    "codex",
  ]);
  expect(
    updateCommand({
      ...base,
      engine: "claude",
      command: "/home/me/.local/bin/claude",
      path: "/home/me/.local/share/claude/versions/2.1.280",
    }),
  ).toEqual(["/home/me/.local/bin/claude", "update"]);
  expect(updateCommand({ ...base, path: "/usr/bin/codex" })).toBeUndefined();
});

function target(command: string, id = "codex"): VersionTarget {
  return {
    id,
    label: "Codex",
    engine: "codex",
    package: "@openai/codex",
    prefix: "/nonexistent/prefix",
    executable: () => ({ command, args: [], env: {} }),
  };
}

it("reports available updates and notifies when an installed CLI changes version", async () => {
  const root = await mkdtemp(join(tmpdir(), "concors-versions-"));
  directories.push(root);
  const binary = join(root, "mise", "installs", "codex", "0.154.0", "codex");
  const launcher = join(root, "codex");
  await mkdir(join(root, "mise", "installs", "codex", "0.154.0"), { recursive: true });
  await writeFile(binary, "binary");
  await symlink(binary, launcher);
  let installed = "0.154.0";
  const runs: string[][] = [];
  const run = vi.fn(async (argv: string[]) => {
    runs.push(argv);
    if (argv[0] === "mise") {
      installed = "0.156.0";
      return { code: 0, output: "upgraded" };
    }
    return { code: 0, output: `codex-cli ${installed}\n` };
  });
  const changed = vi.fn();
  const versions = new ProviderVersions(
    () => [target(launcher)],
    changed,
    run,
    async () => "0.156.0",
  );
  await versions.check();
  expect(versions.get("codex")).toEqual({
    installed: "0.154.0",
    latest: "0.156.0",
    updateAvailable: true,
    updateCommand: "mise upgrade codex",
  });
  expect(changed).not.toHaveBeenCalled();

  versions.update(target(launcher));
  expect(versions.get("codex")?.updating).toBe(true);
  await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(["codex"]));
  expect(versions.get("codex")).toMatchObject({ installed: "0.156.0", updateAvailable: false });
  expect(versions.get("codex")?.updating).toBeUndefined();
  expect(runs).toContainEqual(["mise", "upgrade", "codex"]);
  versions.close();
});

it("keeps the last known release when the registry is unreachable and explains held-back updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "concors-versions-"));
  directories.push(root);
  const binary = join(root, "mise", "installs", "codex", "1.0.0", "codex");
  await mkdir(join(root, "mise", "installs", "codex", "1.0.0"), { recursive: true });
  await writeFile(binary, "binary");
  let registry: string | undefined = "1.1.0";
  const versions = new ProviderVersions(
    () => [target(binary)],
    () => undefined,
    async () => ({ code: 0, output: "1.0.0" }),
    async () => {
      if (!registry) throw new Error("offline");
      return registry;
    },
  );
  await versions.check();
  registry = undefined;
  await versions.check();
  expect(versions.get("codex")?.latest).toBe("1.1.0");
  versions.update(target(binary));
  await vi.waitFor(() => expect(versions.get("codex")?.updating).toBeUndefined());
  expect(versions.get("codex")?.updateError).toMatch(/still 1\.0\.0/);
  versions.close();
});

it("refuses to update installs it cannot attribute", async () => {
  const versions = new ProviderVersions(
    () => [target("/nonexistent/codex")],
    () => undefined,
    async () => ({ code: 0, output: "1.0.0" }),
    async () => "1.1.0",
  );
  await versions.check();
  expect(versions.get("codex")).toEqual({
    installed: "1.0.0",
    latest: "1.1.0",
    updateAvailable: true,
  });
  expect(() => versions.update(target("/nonexistent/codex"))).toThrow(/installed/);
});

async function concorsInstall() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "concors-versions-")));
  directories.push(root);
  const prefix = join(root, "providers", "codex");
  const script = join(prefix, "node_modules", "@openai", "codex", "bin", "codex.js");
  await mkdir(dirname(script), { recursive: true });
  await writeFile(script, "#!/usr/bin/env node\n");
  return { ...target(script), prefix };
}

it("updates Concors-installed CLIs on its own once nothing is using them", async () => {
  const codex = await concorsInstall();
  let installed = "1.0.0";
  let busy = true;
  let finish: () => void = () => undefined;
  const npm = new Promise<void>((resolve) => (finish = resolve));
  const run = vi.fn(async (argv: string[]) => {
    if (argv[0] === "npm") {
      await npm;
      installed = "1.1.0";
      return { code: 0, output: "added 1 package" };
    }
    return { code: 0, output: installed };
  });
  const changed = vi.fn();
  const versions = new ProviderVersions(
    () => [codex],
    changed,
    run,
    async () => "1.1.0",
    () => busy,
  );
  // A turn or a terminal using the CLI defers the update; the button stays available meanwhile.
  await versions.check();
  expect(run.mock.calls.some(([argv]) => argv[0] === "npm")).toBe(false);
  expect(versions.get("codex")).toMatchObject({ updateAvailable: true });
  expect(versions.pending("codex")).toBeUndefined();

  busy = false;
  await versions.check();
  expect(versions.get("codex")?.updating).toBe(true);
  const pending = versions.pending("codex");
  expect(pending).toBeDefined();
  finish();
  await pending;
  expect(changed).toHaveBeenCalledWith(["codex"]);
  expect(versions.get("codex")).toMatchObject({ installed: "1.1.0", updateAvailable: false });
  expect(versions.pending("codex")).toBeUndefined();
  versions.close();
});

it("tries each release once and leaves installs it does not own to the user", async () => {
  const codex = await concorsInstall();
  const run = vi.fn(async (argv: string[]) =>
    argv[0] === "npm" ? { code: 1, output: "npm error network" } : { code: 0, output: "1.0.0" },
  );
  const versions = new ProviderVersions(
    () => [codex],
    () => undefined,
    run,
    async () => "1.1.0",
    () => false,
  );
  await versions.check();
  await versions.pending("codex");
  expect(versions.get("codex")?.updateError).toMatch(/Update failed/);
  await versions.check();
  expect(run.mock.calls.filter(([argv]) => argv[0] === "npm")).toHaveLength(1);
  versions.close();

  // A mise-managed copy belongs to the user's own tooling, idle or not.
  const root = await mkdtemp(join(tmpdir(), "concors-versions-"));
  directories.push(root);
  const binary = join(root, "mise", "installs", "codex", "1.0.0", "codex");
  await mkdir(dirname(binary), { recursive: true });
  await writeFile(binary, "binary");
  const runs: string[][] = [];
  const theirs = new ProviderVersions(
    () => [target(binary)],
    () => undefined,
    async (argv) => {
      runs.push(argv);
      return { code: 0, output: "1.0.0" };
    },
    async () => "1.1.0",
    () => false,
  );
  await theirs.check();
  expect(theirs.get("codex")).toMatchObject({ updateAvailable: true });
  expect(runs.some((argv) => argv[0] === "mise")).toBe(false);
  theirs.close();
});
