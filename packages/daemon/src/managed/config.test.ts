import { mkdtemp, writeFile, rm, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, DEFAULT_CONFIG_PATH, loadConfig, loadTls, parseConfig } from "./config.ts";

const config = {
  machineId: "machine_1",
  hostname: "m-example.concors.app",
  controlPlaneUrl: "https://api.example.test",
  agentToken: "secret",
};
const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "concors-managed-config-"));
  directories.push(dir);
  return dir;
}

describe("managed config", () => {
  it("defaults to the installer paths and port and normalizes the issuer", () => {
    expect(DEFAULT_CONFIG_PATH).toBe("/etc/concors/daemon.json");
    expect(
      parseConfig(JSON.stringify({ ...config, controlPlaneUrl: config.controlPlaneUrl + "/" })),
    ).toEqual({ ...config, port: 443, tlsDir: "/etc/concors/tls" });
  });
  it("loads an explicit config with port and TLS directory", async () => {
    const dir = await directory();
    const file = join(dir, "daemon.json");
    const custom = { ...config, port: 9443, tlsDir: dir };
    await writeFile(file, JSON.stringify(custom));
    expect(await loadConfig(file)).toEqual(custom);
  });
  it.each(["{", "null", "[]", "42", "{}"])("rejects invalid config %s", (text) => {
    expect(() => parseConfig(text)).toThrow(ConfigError);
  });
  it.each([
    { machineId: "" },
    { hostname: "" },
    { agentToken: " " },
    { controlPlaneUrl: "https://" },
    { controlPlaneUrl: "file:///tmp/key" },
    { controlPlaneUrl: "https://u:p@api.test" },
    { controlPlaneUrl: "https://api.test?query" },
    { hostname: "other.test:443" },
    { hostname: "*.concors.app" },
    { hostname: "a/b" },
    { hostname: "-invalid.test" },
    { port: 0 },
    { port: 65536 },
    { port: 1.5 },
    { port: "443" },
    { tlsDir: "" },
    { tlsDir: 3 },
  ])("rejects invalid fields %j", (overrides) => {
    expect(() => parseConfig(JSON.stringify({ ...config, ...overrides }))).toThrow(ConfigError);
  });
  it("refuses missing config or either TLS file and reads the complete pair", async () => {
    const dir = await directory();
    await expect(loadConfig(join(dir, "absent"))).rejects.toThrow(/cannot read/);
    await expect(loadTls(dir)).rejects.toThrow(/cannot read TLS/);
    await writeFile(join(dir, "fullchain.pem"), "certificate");
    await expect(loadTls(dir)).rejects.toThrow(/cannot read TLS/);
    await writeFile(join(dir, "privkey.pem"), "key");
    await expect(loadTls(dir)).resolves.toEqual({ cert: "certificate", key: "key" });
    await rm(join(dir, "fullchain.pem"));
    await expect(loadTls(dir)).rejects.toThrow(/cannot read TLS/);
  });
  it("refuses paths that cannot be read as files", async () => {
    const dir = await directory();
    await mkdir(join(dir, "fullchain.pem"));
    await writeFile(join(dir, "privkey.pem"), "key");
    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadTls(dir)).rejects.toThrow(ConfigError);
  });
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "refuses unreadable files",
    async () => {
      const dir = await directory();
      const file = join(dir, "daemon.json");
      await writeFile(file, JSON.stringify(config), { mode: 0o000 });
      await expect(loadConfig(file)).rejects.toThrow(/cannot read/);
      await chmod(file, 0o600);
      await writeFile(join(dir, "fullchain.pem"), "cert");
      await writeFile(join(dir, "privkey.pem"), "key", { mode: 0o000 });
      await expect(loadTls(dir)).rejects.toThrow(/cannot read TLS/);
    },
  );
});
