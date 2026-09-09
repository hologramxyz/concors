#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { isSea } from "node:sea";
import { createPersistentGateway } from "./hosting/gateway.ts";
import { runSessionHost, stopSessionHost, waitForSessionHost } from "./hosting/session-host.ts";

import { DaemonConfigError, loadDaemonConfig } from "./config.ts";
import { createDaemonServer } from "./server.ts";
import { loadConfig, loadTls, ConfigError } from "./managed/config.ts";
import { createTokenVerifier } from "./managed/auth.ts";
import { createLogger } from "./managed/log.ts";
import { DAEMON_VERSION } from "./version.ts";

const USAGE = `concors-daemon ${DAEMON_VERSION}

Usage:
  concors-daemon serve [--host <host>] [--port <port>] [--log-level <level>]
  concors-daemon --version
  concors-daemon --help

Commands:
  serve            Start a reconnectable gateway; sessions survive gateway restarts.
  stop-host        Stop all sessions (stop the gateway first; for maintenance).

Options:
  --host <host>    Interface to bind (default: 127.0.0.1, env: CONCORS_DAEMON_HOST)
  --port <port>    Port to bind, 0 = random free port (default: 7420, env: CONCORS_DAEMON_PORT)
  --log-level <l>  fatal|error|warn|info|debug|trace|silent (default: info, env: CONCORS_DAEMON_LOG_LEVEL)
  --managed-config <path>  Managed TLS gateway config (env: CONCORS_DAEMON_MANAGED_CONFIG)
  --ephemeral      Own sessions in this process, for isolated tests and temporary machines
  -v, --version    Print the daemon version and exit
  -h, --help       Show this help
`;

interface ParsedCli {
  readonly command: string | undefined;
  readonly version: boolean;
  readonly help: boolean;
  readonly host: string | undefined;
  readonly port: string | undefined;
  readonly logLevel: string | undefined;
  readonly ephemeral: boolean;
  readonly managedConfig: string | undefined;
}

export function parseCli(argv: readonly string[]): ParsedCli {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      version: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
      host: { type: "string" },
      port: { type: "string" },
      "log-level": { type: "string" },
      "managed-config": { type: "string" },
      ephemeral: { type: "boolean", default: false },
    },
  });

  return {
    command: positionals[0],
    version: values.version,
    help: values.help,
    host: values.host,
    port: values.port,
    logLevel: values["log-level"],
    ephemeral: values.ephemeral,
    managedConfig: values["managed-config"],
  };
}

async function serve(cli: ParsedCli): Promise<number> {
  const managedPath = cli.managedConfig ?? process.env["CONCORS_DAEMON_MANAGED_CONFIG"];
  if (managedPath !== undefined && cli.ephemeral)
    throw new DaemonConfigError("--managed-config cannot be combined with --ephemeral");
  const managedConfig = managedPath === undefined ? undefined : await loadConfig(managedPath);
  const tls = managedConfig ? await loadTls(managedConfig.tlsDir) : undefined;
  const config = loadDaemonConfig({
    host: managedConfig ? "0.0.0.0" : cli.host,
    port: managedConfig ? managedConfig.port : cli.port,
    logLevel: cli.logLevel,
  });
  const logger = createLogger(undefined, config.logLevel);
  const dataDir = process.env["CONCORS_DATA_DIR"] ?? join(homedir(), ".concors");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const server = cli.ephemeral
    ? createDaemonServer(config, { workspacePath: join(dataDir, "workspace.sqlite") })
    : createPersistentGateway(
        config,
        dataDir,
        {
          executable: process.execPath,
          args: [
            ...(isSea() ? [] : [fileURLToPath(import.meta.url)]),
            "session-host",
            "--log-level",
            config.logLevel,
          ],
        },
        managedConfig && tls
          ? {
              config: managedConfig,
              tls,
              verifier: createTokenVerifier(managedConfig),
              logger,
            }
          : undefined,
      );

  const url = await server.listen();
  if (["info", "debug", "trace"].includes(config.logLevel))
    process.stdout.write(`concors-daemon ${DAEMON_VERSION} ready at ${url}\n`);

  // Gateway shutdown detaches clients. The session host and its PTYs/providers keep running.
  return new Promise<number>((resolve) => {
    let exiting = false;
    const shutdown = (signal: NodeJS.Signals): void => {
      if (exiting) return;
      exiting = true;
      if (["info", "debug", "trace"].includes(config.logLevel))
        process.stdout.write(`Gateway stopping (${signal})\n`);
      server
        .close()
        .then(() => resolve(0))
        .catch((err: unknown) => {
          console.error(err);
          resolve(1);
        });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

export async function main(argv: readonly string[]): Promise<number> {
  let cli: ParsedCli;
  try {
    cli = parseCli(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(USAGE);
    return 2;
  }

  if (cli.version) {
    process.stdout.write(`${DAEMON_VERSION}\n`);
    return 0;
  }
  if (cli.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  switch (cli.command) {
    case "wait-host":
      await waitForSessionHost(process.env["CONCORS_DATA_DIR"] ?? join(homedir(), ".concors"));
      return 0;
    case "session-host":
      await runSessionHost(
        process.env["CONCORS_DATA_DIR"] ?? join(homedir(), ".concors"),
        loadDaemonConfig({ logLevel: cli.logLevel }),
      );
      return 0;
    case "stop-host":
      await stopSessionHost(process.env["CONCORS_DATA_DIR"] ?? join(homedir(), ".concors"));
      return 0;
    case "serve":
      try {
        return await serve(cli);
      } catch (err) {
        if (err instanceof DaemonConfigError || err instanceof ConfigError) {
          console.error(err.message);
          return 2;
        }
        console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
        return 1;
      }
    case undefined:
      process.stderr.write(USAGE);
      return 2;
    default:
      console.error(`Unknown command: ${cli.command}\n`);
      process.stderr.write(USAGE);
      return 2;
  }
}

// Only act as a CLI when executed directly (not when imported by tests).
if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
