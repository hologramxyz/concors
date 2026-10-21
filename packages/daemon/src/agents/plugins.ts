import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { AgentPlugin, ProviderRequest, ProviderResult } from "@concors/protocol";
import { killTree } from "../host/kill-tree.ts";
import { CodexAppServer } from "./codex/app-server.ts";
import type { launch } from "./providers/launch.ts";
import type { ProviderRegistry } from "./providers/registry.ts";

/**
 * The plugins Claude Code and Codex have installed on the machine, for Settings. Each CLI owns its
 * plugins: installing them, their marketplaces and any sign-in they need stay with the CLI, and
 * Concors only reads the list and turns one on or off through the CLI's own commands, for the
 * account of the configuration asked about. Chats started afterwards load the change.
 */

/** `<plugin>@<marketplace>`, as both CLIs name a plugin. */
function nameParts(id: string) {
  const at = id.lastIndexOf("@");
  return at > 0
    ? { name: id.slice(0, at), marketplace: id.slice(at + 1) }
    : { name: id, marketplace: "" };
}

const ClaudePlugin = z.object({
  id: z.string().min(1).max(300),
  version: z.string().nullish(),
  scope: z.string().nullish(),
  enabled: z.boolean(),
  installPath: z.string().nullish(),
});

/** Reads `claude plugin list --json`; `describe` reads a plugin's manifest for its description. */
export function claudePlugins(
  output: string,
  describe: (installPath: string) => string | null = claudeDescription,
): AgentPlugin[] {
  return z
    .array(ClaudePlugin)
    .parse(JSON.parse(output))
    .slice(0, 500)
    .map((plugin) => ({
      id: plugin.id,
      ...nameParts(plugin.id),
      version: plugin.version?.slice(0, 100) ?? null,
      description: plugin.installPath ? describe(plugin.installPath) : null,
      enabled: plugin.enabled,
      // A project's plugins belong to its settings file and a managed one to the organization.
      canToggle: plugin.scope === "user",
    }));
}

function claudeDescription(installPath: string): string | null {
  try {
    const manifest = z
      .object({ description: z.string().optional() })
      .parse(JSON.parse(readFileSync(join(installPath, ".claude-plugin", "plugin.json"), "utf8")));
    return manifest.description?.slice(0, 1000) || null;
  } catch {
    return null;
  }
}

const CodexPluginList = z.object({
  marketplaces: z.array(
    z.object({
      name: z.string(),
      plugins: z.array(
        z.object({
          id: z.string().min(1).max(300),
          name: z.string(),
          installed: z.boolean(),
          enabled: z.boolean(),
          version: z.string().nullish(),
          localVersion: z.string().nullish(),
          interface: z
            .object({
              displayName: z.string().nullish(),
              shortDescription: z.string().nullish(),
            })
            .nullish(),
        }),
      ),
    }),
  ),
});

/** Reads the Codex app server's `plugin/installed` answer. */
export function codexPlugins(raw: unknown): AgentPlugin[] {
  return CodexPluginList.parse(raw)
    .marketplaces.flatMap((marketplace) =>
      marketplace.plugins
        .filter((plugin) => plugin.installed)
        .map((plugin) => ({
          id: plugin.id,
          name: (plugin.interface?.displayName || plugin.name).slice(0, 200),
          marketplace: marketplace.name.slice(0, 200),
          version: (plugin.localVersion ?? plugin.version)?.slice(0, 100) ?? null,
          description: plugin.interface?.shortDescription?.slice(0, 1000) || null,
          enabled: plugin.enabled,
          canToggle: true,
        })),
    )
    .slice(0, 500);
}

/** Codex's config key for a plugin's switch; the id is quoted, since it may hold dots. */
export function codexPluginKey(id: string) {
  return `plugins."${id.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}".enabled`;
}

/** Runs a CLI to completion, for commands that answer and exit. */
function run(child: ReturnType<typeof launch>, timeoutMs = 20000) {
  return new Promise<string>((resolve, reject) => {
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      killTree(child);
      reject(new Error("Claude Code did not answer in time."));
    }, timeoutMs);
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > 2_000_000) {
        killTree(child);
        reject(new Error("Claude Code's plugin list is too long to show."));
      }
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-2000);
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Could not run Claude Code."));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || "Claude Code could not change its plugins."));
    });
    child.stdin.end();
  });
}

export class AgentPlugins {
  private registry: ProviderRegistry;
  private home: string;
  constructor(registry: ProviderRegistry, home = homedir()) {
    this.registry = registry;
    this.home = home;
  }
  async request(request: ProviderRequest): Promise<ProviderResult> {
    const op = request.operation;
    try {
      if (op.kind !== "plugins" && op.kind !== "plugin-enable")
        throw new Error("Not a plugin request");
      const config = this.registry.config(op.id);
      // The configuration's own account: a subscription keeps plugins of its own.
      const launcher = this.registry.launcher(config, false);
      const change = op.kind === "plugin-enable" ? op : null;
      let plugins: AgentPlugin[];
      if (config.engine === "claude") {
        if (change)
          await run(
            launcher(
              "claude",
              ["plugin", change.enabled ? "enable" : "disable", change.plugin, "--scope", "user"],
              this.home,
            ),
          );
        plugins = claudePlugins(
          await run(launcher("claude", ["plugin", "list", "--json"], this.home)),
        );
      } else if (config.engine === "codex") {
        const server = new CodexAppServer(
          launcher("codex", ["app-server", "--listen", "stdio://"], this.home),
          async () => {
            throw new Error("Listing plugins cannot approve agent tools");
          },
        );
        try {
          await server.initialize();
          if (change)
            await server.request("config/batchWrite", {
              edits: [
                {
                  keyPath: codexPluginKey(change.plugin),
                  value: change.enabled,
                  mergeStrategy: "upsert",
                },
              ],
            });
          plugins = codexPlugins(await server.request("plugin/installed", {}));
        } finally {
          await server.close().catch(() => undefined);
        }
      } else throw new Error("Only Claude Code and Codex have plugins to list here.");
      const listed = this.registry.request({
        type: "provider.request",
        requestId: request.requestId,
        operation: { kind: "list" },
      });
      if (listed.outcome.status === "error") return listed;
      return { ...listed, outcome: { ...listed.outcome, plugins } };
    } catch (error) {
      return {
        type: "provider.result",
        requestId: request.requestId,
        outcome: {
          status: "error",
          message: error instanceof Error ? error.message : "Could not read plugins",
        },
      };
    }
  }
}
