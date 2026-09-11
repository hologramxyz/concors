import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join, delimiter } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import spawn from "cross-spawn";
import { z } from "zod";
import {
  ProviderConfigSchema,
  providerPresets,
  type ProviderConfig,
  type ProviderRequest,
  type ProviderResult,
  type ProviderStatus,
} from "@concors/protocol";
import { resolveTerminalCommand } from "../../terminal/profiles.ts";
import type { launch } from "./launch.ts";

const Saved = z.object({
  revision: z.number().int().nonnegative(),
  providers: z.array(ProviderConfigSchema).max(128),
});
/** Machine-local configuration. Credential values never leave this service. */
export class ProviderRegistry {
  private saved: z.infer<typeof Saved>;
  private jobs = new Map<
    string,
    {
      status: "installing" | "installed" | "failed";
      error?: string | undefined;
      child?: ReturnType<typeof spawn>;
    }
  >();
  private receipts = new Map<string, ProviderResult>();
  readonly directory: string;
  constructor(
    directory = join(process.env["CONCORS_DATA_DIR"] ?? join(homedir(), ".concors"), "providers"),
  ) {
    this.directory = directory;
    const path = join(directory, "config.json");
    this.saved = existsSync(path)
      ? Saved.parse(JSON.parse(readFileSync(path, "utf8")))
      : { revision: 0, providers: [] };
  }
  get revision() {
    return this.saved.revision;
  }
  configs(): ProviderConfig[] {
    return [
      ...providerPresets
        .map((p) => ProviderConfigSchema.parse(p))
        .filter((p) => !this.saved.providers.some((c) => c.id === p.id)),
      ...this.saved.providers,
    ];
  }
  config(id: string): ProviderConfig {
    const config = this.configs().find((p) => p.id === id);
    if (!config) throw new Error("Unknown provider. Add it in Settings → Providers.");
    return config;
  }
  private persist() {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temp = join(this.directory, `${randomUUID()}.tmp`);
    writeFileSync(temp, JSON.stringify(this.saved, null, 2), { mode: 0o600 });
    renameSync(temp, join(this.directory, "config.json"));
  }
  terminalEnvironment(): NodeJS.ProcessEnv {
    const bins = this.configs()
      .filter((c) => c.enabled)
      .map((c) => join(this.directory, c.id, "node_modules", ".bin"))
      .filter((path) => existsSync(path));
    return { ...process.env, PATH: [...bins, process.env["PATH"] ?? ""].join(delimiter) };
  }
  private env(config: ProviderConfig): NodeJS.ProcessEnv {
    const bin = join(this.directory, config.id, "node_modules", ".bin");
    return {
      ...process.env,
      ...config.env,
      PATH: bin + delimiter + (config.env?.["PATH"] ?? process.env["PATH"] ?? ""),
    };
  }
  private argv(config: ProviderConfig): string[] {
    const preset = providerPresets.find((p) => p.id === config.id);
    // npx presets use a previously installed package, never an implicit download during discovery.
    if (
      preset?.install?.kind === "npx" &&
      JSON.stringify(config.command) === JSON.stringify(preset.command)
    ) {
      const pkg = preset.install.package.replace(/@[^@/]+$/, "");
      const root = join(this.directory, config.id, "node_modules", pkg);
      const meta = z
        .object({ name: z.string(), bin: z.union([z.string(), z.record(z.string(), z.string())]) })
        .parse(JSON.parse(readFileSync(join(root, "package.json"), "utf8")));
      const binary =
        typeof meta.bin === "string"
          ? meta.bin
          : (meta.bin[meta.name.split("/").at(-1) ?? meta.name] ??
            (Object.values(meta.bin).length === 1 ? Object.values(meta.bin)[0] : undefined));
      if (!binary)
        throw new Error("Package has multiple executables. Set its command in Providers settings.");
      return [process.execPath, join(root, binary), ...config.command.slice(3)];
    }
    return config.command;
  }
  installed(config: ProviderConfig): boolean {
    try {
      const [command, ...args] = this.argv(config);
      resolveTerminalCommand(command ?? "", args, process.platform, this.env(config));
      return true;
    } catch {
      return false;
    }
  }
  launcher(config: ProviderConfig): typeof launch {
    if (!config.enabled) throw new Error("This provider is disabled in Settings → Providers.");
    if (!this.installed(config))
      throw new Error(
        `${config.label} is not installed. Open Settings → Providers on this machine.`,
      );
    return (_provider, args, cwd, env) => {
      const [command, ...prefix] = this.argv(config);
      const merged = { ...env, ...this.env(config) };
      // Internal transport credentials/configuration belong to the adapter, even if a
      // profile supplies similarly named variables. Other profile variables win as usual.
      for (const [key, value] of Object.entries(env ?? {}))
        if (
          (config.engine === "opencode" &&
            [
              "OPENCODE_SERVER_USERNAME",
              "OPENCODE_SERVER_PASSWORD",
              "OPENCODE_CONFIG_CONTENT",
            ].includes(key)) ||
          (process.env[key] !== value && !(key in (config.env ?? {})))
        )
          merged[key] = value;
      const resolved = resolveTerminalCommand(command ?? "", [], process.platform, merged, cwd);
      return spawn(
        process.platform === "win32" ? (command ?? "") : resolved.command,
        [...prefix, ...args],
        { cwd, env: merged, stdio: "pipe", windowsHide: true },
      ) as ReturnType<typeof launch>;
    };
  }
  statuses(): ProviderStatus[] {
    return this.configs().map((config) => {
      const { env, params, ...publicConfig } = config;
      const preset = providerPresets.find((p) => p.id === config.id),
        job = this.jobs.get(config.id);
      return {
        ...publicConfig,
        ...(params?.supportsMcpServers === undefined
          ? {}
          : { params: { supportsMcpServers: params.supportsMcpServers } }),
        mcpServerNames: params?.mcpServers?.map((s) => s.name) ?? [],
        envKeys: Object.keys(env ?? {}),
        installed: this.installed(config),
        customized: this.saved.providers.some((p) => p.id === config.id),
        canInstall: !!preset?.install,
        installLink: preset?.installLink,
        installStatus: job?.status ?? "idle",
        ...(job?.error ? { error: job.error } : {}),
      };
    });
  }
  request(request: ProviderRequest): ProviderResult {
    const op = request.operation;
    if (op.kind !== "list" && this.receipts.has(request.requestId))
      return this.receipts.get(request.requestId) as ProviderResult;
    let result: ProviderResult;
    const savedBefore = structuredClone(this.saved);
    try {
      if (op.kind === "save" || op.kind === "remove") {
        if (op.expectedRevision !== this.saved.revision)
          throw new Error("Provider settings changed on another client. Reload before saving.");
        if (op.kind === "save") {
          const config = ProviderConfigSchema.parse(op.config),
            previous = this.configs().find((p) => p.id === config.id);
          config.env = { ...previous?.env, ...config.env };
          config.params = { ...previous?.params, ...config.params };
          if (
            config.params.mcpServers?.length &&
            (["pi", "omp"].includes(config.engine) || config.params.supportsMcpServers === false)
          )
            throw new Error("This provider manages MCP through its own CLI configuration.");
          if (config.engine === "codex" && config.params.mcpServers?.some((s) => s.type === "sse"))
            throw new Error("Codex requires HTTP or stdio MCP servers.");
          config.env = Object.fromEntries(
            Object.entries(config.env).filter(([key]) => !op.removeEnv?.includes(key)),
          );
          if (!previous && this.configs().length >= 128) throw new Error("Provider limit reached");
          this.saved.providers = [
            ...this.saved.providers.filter((p) => p.id !== config.id),
            config,
          ];
        } else this.saved.providers = this.saved.providers.filter((p) => p.id !== op.id);
        this.saved.revision++;
        this.persist();
      }
      if (op.kind === "install") this.install(op.id);
      result = {
        type: "provider.result",
        requestId: request.requestId,
        outcome: { status: "ok", revision: this.saved.revision, providers: this.statuses() },
      };
    } catch (error) {
      this.saved = savedBefore;
      result = {
        type: "provider.result",
        requestId: request.requestId,
        outcome: {
          status: "error",
          message: error instanceof Error ? error.message : "Could not update provider settings",
        },
      };
    }
    if (op.kind !== "list") {
      if (this.receipts.size > 256) this.receipts.delete(this.receipts.keys().next().value ?? "");
      this.receipts.set(request.requestId, result);
    }
    return result;
  }
  private install(id: string) {
    if (this.jobs.get(id)?.status === "installing") return;
    if ([...this.jobs.values()].filter((j) => j.status === "installing").length >= 2)
      throw new Error("Wait for the current installations to finish.");
    const preset = providerPresets.find((p) => p.id === id);
    if (!preset?.install)
      throw new Error("Use the provider's installation guide, then configure its executable here.");
    const env = { ...process.env };
    const npm = resolveTerminalCommand("npm", [], process.platform, env);
    const prefix = join(this.directory, id);
    mkdirSync(prefix, { recursive: true, mode: 0o700 });
    const child = spawn(
      process.platform === "win32" ? "npm" : npm.command,
      [
        "install",
        "--prefix",
        prefix,
        "--no-audit",
        "--no-fund",
        "--save-exact",
        preset.install.package,
      ],
      { env, cwd: prefix, stdio: "pipe", windowsHide: true },
    );
    const job = {
      status: "installing" as "installing" | "installed" | "failed",
      child,
      error: undefined as string | undefined,
    };
    this.jobs.set(id, job);
    child.stdout?.resume();
    child.stderr?.resume();
    const timer = setTimeout(() => {
      job.error = "Installation timed out. Check the machine's network and retry.";
      child.kill();
    }, 300000);
    child.once("error", () => {
      clearTimeout(timer);
      job.status = "failed";
      job.error = "Could not start npm on this machine.";
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      job.status = code === 0 && !job.error ? "installed" : "failed";
      if (job.status === "failed")
        job.error ??= `Installation failed (exit ${code ?? "unknown"}). Check the provider's installation guide.`;
      else {
        const config = this.config(id);
        const previous = { ...this.saved };
        this.saved.providers = [
          ...this.saved.providers.filter((p) => p.id !== id),
          { ...config, enabled: true },
        ];
        this.saved.revision++;
        try {
          this.persist();
        } catch {
          this.saved = previous;
          job.status = "failed";
          job.error = "Installed, but could not save provider settings.";
        }
      }
    });
  }
  close() {
    for (const job of this.jobs.values()) if (job.status === "installing") job.child?.kill();
  }
}
