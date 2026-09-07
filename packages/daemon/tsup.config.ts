import { defineConfig } from "tsup";

/**
 * Produces `dist/cli.js`, the entry point behind the `concors-daemon` binary.
 *
 * Workspace packages are inlined so `dist/` only depends on published npm packages. For the
 * standalone executable that ships with the desktop app (see packages/daemon/README.md), the same
 * config is run with a catch-all `noExternal` regex so every dependency is bundled, and the result
 * is fed to Node's single executable application (SEA) tooling.
 */
export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  // node:sqlite is a prefix-only builtin; stripping node: turns it into an npm import.
  removeNodeProtocol: false,
  outDir: "dist",
  sourcemap: true,
  clean: true,
  splitting: false,
  noExternal: ["@concors/protocol"],
});
