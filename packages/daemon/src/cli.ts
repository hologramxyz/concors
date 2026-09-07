#!/usr/bin/env node
import { parseArgs } from "node:util";

import { DaemonConfigError, loadDaemonConfig } from "./config.ts";
import { createDaemonServer } from "./server.ts";
import { DAEMON_VERSION } from "./version.ts";

const USAGE = `concors-daemon ${DAEMON_VERSION}

Usage:
  concors-daemon serve [--host <host>] [--port <port>] [--log-level <level>]
  concors-daemon --version
  concors-daemon --help

Commands:
  serve            Start the daemon and listen for Concors clients.

Options:
  --host <host>    Interface to bind (default: 127.0.0.1, env: CONCORS_DAEMON_HOST)
  --port <port>    Port to bind, 0 = random free port (default: 7420, env: CONCORS_DAEMON_PORT)
  --log-level <l>  fatal|error|warn|info|debug|trace|silent (default: info, env: CONCORS_DAEMON_LOG_LEVEL)
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
    },
  });

  return {
    command: positionals[0],
    version: values.version,
    help: values.help,
    host: values.host,
    port: values.port,
    logLevel: values["log-level"],
  };
}

async function serve(cli: ParsedCli): Promise<number> {
  const config = loadDaemonConfig({ host: cli.host, port: cli.port, logLevel: cli.logLevel });
  const server = createDaemonServer(config);

  const url = await server.listen();
  server.app.log.info({ url, version: DAEMON_VERSION }, "concors-daemon ready");

  // Graceful shutdown: stop accepting work, close client sockets, then exit. Later this is also
  // where agent sessions get terminated cleanly.
  return new Promise<number>((resolve) => {
    let exiting = false;
    const shutdown = (signal: NodeJS.Signals): void => {
      if (exiting) return;
      exiting = true;
      server.app.log.info({ signal }, "shutting down");
      server
        .close()
        .then(() => resolve(0))
        .catch((err: unknown) => {
          server.app.log.error({ err }, "error during shutdown");
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
    case "serve":
      try {
        return await serve(cli);
      } catch (err) {
        if (err instanceof DaemonConfigError) {
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
