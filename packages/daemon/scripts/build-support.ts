import { chmod, cp, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire, isBuiltin } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, realpathSync } from "node:fs";

const require = createRequire(import.meta.url);

function packageDirectory(entry: string): string {
  let directory = dirname(entry);
  while (!existsSync(join(directory, "package.json"))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate package for ${entry}`);
    directory = parent;
  }
  return directory;
}

/** Dynamic native loading must remain on disk, including macOS helpers and Windows ConPTY DLLs. */
export async function copyNativePackage(outDir: string): Promise<void> {
  const name = `@lydell/node-pty-${process.platform}-${process.arch}`;
  const ptyRequire = createRequire(require.resolve("@lydell/node-pty"));
  const source = packageDirectory(ptyRequire.resolve(name));
  const target = join(outDir, "node_modules", name);
  await cp(source, target, { recursive: true, dereference: true });
  if (process.platform === "darwin")
    await chmod(join(target, "prebuilds", `darwin-${process.arch}`, "spawn-helper"), 0o755);
}

/** Preserve redistribution notices for the dependency graph whose JS is now bundled. */
export async function writeDependencyNotices(outDir: string, root: string): Promise<void> {
  const seen = new Set<string>();
  const notices: string[] = [];
  async function visit(directory: string): Promise<void> {
    if (seen.has(directory)) return;
    seen.add(directory);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as {
      name: string;
      version: string;
      license?: string;
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    notices.push(
      `${manifest.name}@${manifest.version} (${manifest.license ?? "see package license"})`,
    );
    for (const file of (await readdir(directory)).sort()) {
      if (/^(licen[cs]e|copying|notice)(\.|$)/i.test(file))
        notices.push(await readFile(join(directory, file), "utf8"));
    }
    const localRequire = createRequire(join(directory, "package.json"));
    for (const name of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    }).sort()) {
      if (isBuiltin(name)) continue;
      // Licenses belong to the package root, not a CJS/ESM entry's nearest
      // package.json. Some SDKs intentionally publish only subpath entry points.
      const dependency = (localRequire.resolve.paths(name) ?? [])
        .map((modules) => join(modules, name))
        .find((candidate) => existsSync(join(candidate, "package.json")));
      if (!dependency) {
        if (name in (manifest.optionalDependencies ?? {})) continue;
        throw new Error(`Cannot locate dependency notices for ${name} from ${directory}`);
      }
      await visit(realpathSync(dependency));
    }
  }
  await visit(root);
  await writeFile(join(outDir, "THIRD_PARTY_NOTICES.txt"), notices.join("\n\n---\n\n"));
}
