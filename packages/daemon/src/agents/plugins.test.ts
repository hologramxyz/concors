import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AgentPlugins, claudePlugins, codexPluginKey, codexPlugins } from "./plugins.ts";
import { ProviderRegistry } from "./providers/registry.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const done of cleanup.splice(0)) await done();
});

it("reads Claude Code's plugin list, and lets only the person's own plugins be switched", () => {
  const plugins = claudePlugins(
    JSON.stringify([
      {
        id: "figma@claude-plugins-official",
        version: "2.2.157",
        scope: "user",
        enabled: true,
        installPath: "/plugins/figma",
        mcpServers: { figma: { type: "http", url: "https://mcp.figma.com/mcp" } },
      },
      { id: "formatter@acme", scope: "project", enabled: false },
      { id: "required@org", scope: "managed", enabled: true },
    ]),
    (path) => (path === "/plugins/figma" ? "Design to code" : null),
  );
  expect(plugins).toEqual([
    {
      id: "figma@claude-plugins-official",
      name: "figma",
      marketplace: "claude-plugins-official",
      version: "2.2.157",
      description: "Design to code",
      enabled: true,
      canToggle: true,
    },
    {
      id: "formatter@acme",
      name: "formatter",
      marketplace: "acme",
      version: null,
      description: null,
      enabled: false,
      canToggle: false,
    },
    expect.objectContaining({ id: "required@org", canToggle: false }),
  ]);
});

it("lists only the Codex plugins installed, under their display names", () => {
  expect(
    codexPlugins({
      marketplaces: [
        {
          name: "openai-curated",
          path: null,
          interface: null,
          plugins: [
            {
              id: "vercel@openai-curated",
              name: "vercel",
              installed: true,
              enabled: true,
              version: "1.4.0",
              localVersion: "1.3.0",
              interface: { displayName: "Vercel", shortDescription: "Deploy and preview" },
              authPolicy: "ON_USE",
            },
            { id: "linear@openai-curated", name: "linear", installed: false, enabled: false },
          ],
        },
      ],
      marketplaceLoadErrors: [],
    }),
  ).toEqual([
    {
      id: "vercel@openai-curated",
      name: "Vercel",
      marketplace: "openai-curated",
      version: "1.3.0",
      description: "Deploy and preview",
      enabled: true,
      canToggle: true,
    },
  ]);
});

it("quotes a Codex plugin's id in its config key, as Codex parses key paths", () => {
  expect(codexPluginKey("vercel@openai-curated")).toBe('plugins."vercel@openai-curated".enabled');
  expect(codexPluginKey('odd."name\\@x')).toBe('plugins."odd.\\"name\\\\@x".enabled');
});

it("switches a Claude Code plugin through the CLI, for the person's own settings", async () => {
  if (process.platform === "win32") return;
  const directory = await mkdtemp(join(tmpdir(), "concors-plugins-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, "bin");
  await mkdir(bin);
  const calls = join(directory, "calls.txt");
  // A stand-in CLI: records each call and answers the list as Claude Code does.
  await writeFile(
    join(bin, "claude"),
    `#!/bin/sh
echo "$@" >> ${JSON.stringify(calls)}
if [ "$2" = "list" ]; then
  echo '[{"id":"figma@claude-plugins-official","version":"2.2.157","scope":"user","enabled":false}]'
fi
`,
    { mode: 0o755 },
  );
  vi.stubEnv("PATH", `${bin}:/usr/bin:/bin`);
  const plugins = new AgentPlugins(new ProviderRegistry(join(directory, "providers")), directory);
  const result = await plugins.request({
    type: "provider.request",
    requestId: crypto.randomUUID(),
    operation: {
      kind: "plugin-enable",
      id: "claude",
      plugin: "figma@claude-plugins-official",
      enabled: false,
    },
  });
  expect(result.outcome).toMatchObject({
    status: "ok",
    plugins: [{ id: "figma@claude-plugins-official", enabled: false, canToggle: true }],
  });
  expect((await readFile(calls, "utf8")).trim().split("\n")).toEqual([
    "plugin disable figma@claude-plugins-official --scope user",
    "plugin list --json",
  ]);
});

it("explains that only Claude Code and Codex have plugins to list", async () => {
  const directory = await mkdtemp(join(tmpdir(), "concors-plugins-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const plugins = new AgentPlugins(new ProviderRegistry(join(directory, "providers")), directory);
  const result = await plugins.request({
    type: "provider.request",
    requestId: crypto.randomUUID(),
    operation: { kind: "plugins", id: "opencode" },
  });
  expect(result.outcome.status).toBe("error");
});
