import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { writeDependencyNotices } from "./build-support.ts";

it("retains license notices for dependencies that only export subpaths", async () => {
  const root = await mkdtemp(join(tmpdir(), "concors-notices-"));
  try {
    const dependency = join(root, "node_modules", "subpath-sdk"),
      out = join(root, "dist");
    await mkdir(dependency, { recursive: true });
    await mkdir(out);
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "fixture",
        version: "1",
        dependencies: { "subpath-sdk": "1" },
        optionalDependencies: { "missing-platform-addon": "1" },
      }),
    );
    await writeFile(
      join(dependency, "package.json"),
      JSON.stringify({
        name: "subpath-sdk",
        version: "1.2.3",
        license: "MIT",
        exports: { "./server": "./server.js" },
      }),
    );
    await writeFile(join(dependency, "LICENSE"), "Fixture redistribution notice");
    await writeDependencyNotices(out, root);
    const notices = await readFile(join(out, "THIRD_PARTY_NOTICES.txt"), "utf8");
    expect(notices).toContain("subpath-sdk@1.2.3 (MIT)");
    expect(notices).toContain("Fixture redistribution notice");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
