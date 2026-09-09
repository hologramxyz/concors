import { cp, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defineConfig } from "tsup";
import { copyNativePackage, writeDependencyNotices } from "./scripts/build-support.ts";

const manifestPath = resolve("package.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
  name: string;
  version: string;
};

/** JS dependencies are inlined; only the current platform's native PTY package stays external. */
export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  removeNodeProtocol: false,
  outDir: "dist",
  sourcemap: true,
  clean: true,
  splitting: false,
  noExternal: [/.*/],
  // Bundled CommonJS dependencies still require Node builtins and the native PTY package.
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  esbuildOptions(options) {
    // Match Node's CommonJS entry selection (not browser/ESM variants of xterm).
    options.mainFields = ["main", "module"];
  },
  esbuildPlugins: [
    {
      name: "daemon-version-only",
      setup(build) {
        // version.ts needs only version: never embed workspace:* dependency metadata in the artifact.
        build.onLoad({ filter: /package\.json$/ }, async (args) => {
          if (args.path !== manifestPath) return undefined;
          return { contents: JSON.stringify({ version: manifest.version }), loader: "json" };
        });
      },
    },
  ],
  async onSuccess() {
    await copyNativePackage("dist");
    await cp(resolve("../../LICENSE"), "dist/LICENSE");
    await writeDependencyNotices("dist", dirname(manifestPath));
    await writeFile(
      "dist/package.json",
      JSON.stringify(
        { name: manifest.name, version: manifest.version, type: "module", private: true },
        null,
        2,
      ) + "\n",
    );
  },
});
