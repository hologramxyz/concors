import { DEFAULT_LOCAL_DAEMON_PORT, WS_PATH } from "@concors/protocol";

/**
 * Where a daemon lives. The protocol spoken over the connection is identical for both kinds; the
 * distinction only matters for UX (labels, trust indicators) and, later, for authentication —
 * remote endpoints will carry credentials, local ones will not.
 */
export interface DaemonEndpoint {
  /** Full WebSocket URL, e.g. `ws://127.0.0.1:7420/ws` or `wss://daemon.example.com/ws`. */
  readonly url: string;
  /** `local` for loopback daemons managed by the client host, `remote` for everything else. */
  readonly kind: "local" | "remote";
  /** Optional human-readable name shown in the UI. */
  readonly label?: string;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export class InvalidDaemonUrlError extends Error {
  override readonly name = "InvalidDaemonUrlError";
}

/**
 * Builds a `DaemonEndpoint` from a URL, inferring `kind` from the host.
 *
 * Accepts `ws://` and `wss://` (and, for convenience, `http(s)://`, which is rewritten to the
 * WebSocket scheme). If the URL has no path, the protocol's `WS_PATH` is appended.
 */
export function describeDaemonEndpoint(rawUrl: string, label?: string): DaemonEndpoint {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new InvalidDaemonUrlError(`Invalid daemon URL: ${rawUrl}`);
  }

  switch (url.protocol) {
    case "ws:":
    case "wss:":
      break;
    case "http:":
      url.protocol = "ws:";
      break;
    case "https:":
      url.protocol = "wss:";
      break;
    default:
      throw new InvalidDaemonUrlError(
        `Unsupported daemon URL scheme "${url.protocol}" in ${rawUrl} (expected ws:// or wss://)`,
      );
  }

  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = WS_PATH;
  }

  const kind: DaemonEndpoint["kind"] = LOOPBACK_HOSTS.has(url.hostname) ? "local" : "remote";
  const endpoint: DaemonEndpoint = { url: url.toString(), kind };
  return label === undefined ? endpoint : { ...endpoint, label };
}

/** Endpoint of a daemon running on the same machine as the client. */
export function localDaemonEndpoint(port: number = DEFAULT_LOCAL_DAEMON_PORT): DaemonEndpoint {
  return describeDaemonEndpoint(`ws://127.0.0.1:${port}${WS_PATH}`, "Local daemon");
}
