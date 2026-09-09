import { readFile } from "node:fs/promises";
import path from "node:path";

/*
 * What the control plane writes on the machine when it installs the agent:
 * `/etc/concors/daemon.json` plus the certificate pair in `/etc/concors/tls`.
 */

export const DEFAULT_CONFIG_PATH = "/etc/concors/daemon.json";
export const DEFAULT_TLS_DIR = "/etc/concors/tls";
export const DEFAULT_PORT = 443;

export interface ManagedConfig {
  /** Machine id at the control plane; the `aud` of every accepted token. */
  machineId: string;
  /** Name the certificate is for (`m-xxxxxxxxxx.concors.app`). */
  hostname: string;
  /** Control plane base URL: token issuer, JWKS and heartbeat endpoint. */
  controlPlaneUrl: string;
  /** Credential for heartbeats, known only to this machine and the control plane. */
  agentToken: string;
  port: number;
  tlsDir: string;
}

export interface TlsMaterial {
  cert: string;
  key: string;
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export function parseConfig(text: string): ManagedConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ConfigError("managed daemon config is not valid JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new ConfigError("managed daemon config is not an object");
  const record = raw as Record<string, unknown>;

  const string = (key: string): string => {
    const value = record[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ConfigError(`managed daemon config: "${key}" must be a non-empty string`);
    }
    return value;
  };

  const controlPlaneUrl = string("controlPlaneUrl").replace(/\/+$/, "");
  let base: URL;
  try {
    base = new URL(controlPlaneUrl);
  } catch {
    throw new ConfigError('managed daemon config: "controlPlaneUrl" must be an http(s) URL');
  }
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new ConfigError('managed daemon config: "controlPlaneUrl" must be an http(s) URL');
  }
  const port = record["port"] ?? DEFAULT_PORT;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError('managed daemon config: "port" must be a port number');
  }
  const tlsDir = record["tlsDir"] ?? DEFAULT_TLS_DIR;
  if (typeof tlsDir !== "string" || !path.isAbsolute(tlsDir))
    throw new ConfigError('managed daemon config: "tlsDir" must be an absolute path');

  const hostname = string("hostname");
  if (
    hostname.length > 253 ||
    !hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  )
    throw new ConfigError('managed daemon config: "hostname" must be a DNS hostname');

  return {
    machineId: string("machineId"),
    hostname: hostname.toLowerCase(),
    controlPlaneUrl,
    agentToken: string("agentToken"),
    port,
    tlsDir,
  };
}

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH): Promise<ManagedConfig> {
  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch (error) {
    throw new ConfigError(
      `cannot read ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseConfig(text);
}

export async function loadTls(tlsDir: string): Promise<TlsMaterial> {
  const [cert, key] = await Promise.all([
    readFile(path.join(tlsDir, "fullchain.pem"), "utf8"),
    readFile(path.join(tlsDir, "privkey.pem"), "utf8"),
  ]).catch((error: unknown) => {
    throw new ConfigError(
      `cannot read TLS files in ${tlsDir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  if (!cert.trim() || !key.trim()) throw new ConfigError(`empty TLS files in ${tlsDir}`);
  return { cert, key };
}
