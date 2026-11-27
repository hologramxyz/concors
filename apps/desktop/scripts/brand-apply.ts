// `pnpm brand:apply [--check]`: puts the files in brand/incoming/ where the apps use them.
//
// 1. A source in brand/incoming/sources/ that differs from where it is used is copied there, and
//    everything made from it is regenerated (desktop icons, phone icons, favicon).
// 2. Every other file in the folder is then copied to its place, so a file dropped in by hand wins
//    over the generated one. A file left as it was is refreshed from the regenerated one instead.
// 3. The store images are re-rendered if the icon or favicon they show changed.
// With --check it only lists what differs, and exits 1 if anything does.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const FOLDER = "brand/incoming";

export interface Manifest {
  /** Masters. `copyTo` is where the file is used; `regenerate` names generators to run. */
  sources: Record<string, { copyTo?: string[]; regenerate?: string[]; readBy?: string[] }>;
  /** Every other file in the folder, and where it is used, relative to the repo root. */
  files: Record<string, string[]>;
}

export interface Generator {
  /** Files or folders it writes, relative to the repo root. */
  outputs: string[];
  /** If set, it runs after the copies whenever one of these files changed, not on request. */
  inputs?: string[];
  run(root: string): void;
}

function exec(root: string, command: string, args: string[]) {
  try {
    execFileSync(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${String(stdout ?? "")}${String(stderr ?? "")}`,
      { cause: error },
    );
  }
}

/** The favicon is the app icon without the fixed render size on its root element. */
export function faviconFrom(appIcon: string) {
  return appIcon.replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\s(?:width|height)="[^"]*"/g, ""));
}

const ICONS = "apps/desktop/src-tauri/icons";
const PHONE = ["icon", "adaptive-icon", "notification-icon", "splash", "splash-dark"].map(
  (name) => `apps/mobile/assets/${name}.png`,
);

export const GENERATORS: Record<string, Generator> = {
  "desktop-icons": {
    outputs: [ICONS],
    run(root) {
      exec(root, "pnpm", [
        "--filter",
        "@concors/desktop",
        "tauri",
        "icon",
        `src-tauri/icons/source.svg`,
      ]);
      // `tauri icon` also writes Tauri's own mobile sets; the phone app is Expo and has its own.
      for (const folder of ["android", "ios"])
        rmSync(join(root, ICONS, folder), { recursive: true, force: true });
    },
  },
  "mobile-icons": {
    outputs: PHONE,
    run(root) {
      exec(root, process.execPath, ["apps/mobile/scripts/app-icons.mjs"]);
    },
  },
  favicon: {
    outputs: ["apps/desktop/public/favicon.svg"],
    run(root) {
      const icon = readFileSync(join(root, ICONS, "source.svg"), "utf8");
      writeFileSync(join(root, "apps/desktop/public/favicon.svg"), faviconFrom(icon));
    },
  },
  "store-images": {
    inputs: ["apps/desktop/public/favicon.svg", "apps/mobile/assets/icon.png"],
    outputs: [
      "apps/mobile/release/google-play/exports",
      "apps/mobile/release/google-play/asset-manifest.json",
      "apps/mobile/release/marketing/exports",
    ],
    run(root) {
      for (const store of ["google-play", "marketing"])
        exec(root, process.execPath, [`apps/mobile/release/${store}/render.mjs`]);
    },
  },
};

function hash(path: string) {
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
}

function filesUnder(root: string, path: string): string[] {
  const full = join(root, path);
  if (!existsSync(full)) return [path];
  if (!statSync(full).isDirectory()) return [path];
  return readdirSync(full)
    .filter((name) => name !== ".DS_Store")
    .flatMap((name) => filesUnder(root, join(path, name)));
}

function snapshot(root: string, paths: string[]) {
  return new Map(
    paths.flatMap((path) => filesUnder(root, path)).map((path) => [path, hash(join(root, path))]),
  );
}

function copy(root: string, from: string, to: string) {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  copyFileSync(join(root, from), join(root, to));
}

export interface Options {
  root: string;
  check?: boolean;
  generators?: Record<string, Generator>;
  log?: (line: string) => void;
}

export function applyBrand({
  root,
  check = false,
  generators = GENERATORS,
  log = (line: string) => process.stdout.write(`${line}\n`),
}: Options) {
  const manifest = JSON.parse(
    readFileSync(join(root, FOLDER, "manifest.json"), "utf8"),
  ) as Manifest;
  const at = (path: string) => `${FOLDER}/${path}`;
  const listed = [...Object.keys(manifest.sources), ...Object.keys(manifest.files)];
  for (const path of listed)
    if (!existsSync(join(root, at(path))))
      throw new Error(`${at(path)} is in manifest.json but not in the folder`);
  const known = new Set([...listed, "README.md", "manifest.json"]);
  for (const path of filesUnder(root, FOLDER).map((file) => relative(FOLDER, file)))
    if (!known.has(path)) log(`Skipped ${at(path)}: manifest.json does not say where it goes`);

  const differs = (from: string, to: string) => hash(join(root, from)) !== hash(join(root, to));
  const changedSources = Object.entries(manifest.sources).filter(([path, source]) =>
    (source.copyTo ?? []).some((target) => differs(at(path), target)),
  );
  const toRegenerate = [
    ...new Set(changedSources.flatMap(([, source]) => source.regenerate ?? [])),
  ];
  for (const name of toRegenerate)
    if (!generators[name]) throw new Error(`manifest.json names an unknown generator: ${name}`);

  if (check) {
    const differences = [
      ...changedSources.map(
        ([path, source]) =>
          `${at(path)} changed: would regenerate ${(source.regenerate ?? []).join(", ") || "nothing"}`,
      ),
      ...Object.entries(manifest.files).flatMap(([path, targets]) =>
        targets
          .filter((target) => differs(at(path), target))
          .map((target) => `${at(path)} differs from ${target}`),
      ),
    ];
    for (const line of differences) log(line);
    if (differences.length === 0) log(`Nothing differs: ${FOLDER} matches the apps.`);
    return { changed: [] as string[], differences };
  }

  const late = Object.entries(generators).filter(([, generator]) => generator.inputs);
  const watched = [
    FOLDER,
    ...Object.values(manifest.sources).flatMap((source) => source.copyTo ?? []),
    ...Object.values(manifest.files).flat(),
    ...Object.values(generators).flatMap((generator) => [
      ...generator.outputs,
      ...(generator.inputs ?? []),
    ]),
  ];
  const before = snapshot(root, watched);

  for (const [path, source] of changedSources)
    for (const target of source.copyTo ?? []) copy(root, at(path), target);
  for (const name of toRegenerate) {
    log(`Regenerating ${name}…`);
    generators[name]?.run(root);
  }

  for (const [path, targets] of Object.entries(manifest.files)) {
    const mine = hash(join(root, at(path)));
    const dropped = targets.some((target) => before.get(target) !== mine);
    if (dropped) for (const target of targets) copy(root, at(path), target);
    else if (targets[0] && differs(at(path), targets[0])) copy(root, targets[0], at(path));
  }

  for (const [name, generator] of late)
    if (generator.inputs?.some((input) => before.get(input) !== hash(join(root, input)))) {
      log(`Regenerating ${name}…`);
      generator.run(root);
    }

  const after = snapshot(root, watched);
  const changed = [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
  if (changed.length === 0) log(`Nothing to change: ${FOLDER} matches the apps.`);
  else {
    log(`Changed ${changed.length} file${changed.length === 1 ? "" : "s"}:`);
    for (const path of changed) log(`  ${after.get(path) === null ? "deleted" : "wrote"} ${path}`);
  }
  const svg = "apps/desktop/src-tauri/macos/dmg-background.svg";
  if (changed.includes(svg) && !changed.includes(svg.replace(/svg$/, "tiff")))
    log(
      `The disk image still shows the old background: make dmg-background.tiff by hand (see the README).`,
    );
  return { changed, differences: [] as string[] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = applyBrand({
      root: fileURLToPath(new URL("../../../", import.meta.url)),
      check: process.argv.includes("--check"),
    });
    if (result.differences.length > 0) process.exitCode = 1;
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
