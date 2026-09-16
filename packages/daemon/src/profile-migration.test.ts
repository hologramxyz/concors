import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { adoptLegacyData } from "./profile-migration.ts";
import { profileDir } from "./profile.ts";

const PROD = "https://api.concors.dev";
const created: string[] = [];

async function base(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "concors-profile-"));
  created.push(dir);
  return dir;
}

async function legacyInstall(dir: string): Promise<void> {
  await writeFile(join(dir, "workspace.sqlite"), "database");
  await writeFile(join(dir, "workspace.sqlite-wal"), "wal");
  await writeFile(join(dir, "session-host.log"), "log");
  await mkdir(join(dir, "providers"), { recursive: true });
  await writeFile(join(dir, "providers", "anthropic.json"), "credential");
}

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("adoptLegacyData", () => {
  it("moves an unpartitioned install into the first profile", async () => {
    const dir = await base();
    await legacyInstall(dir);
    const env = { CONCORS_DATA_DIR: dir };
    const target = profileDir({ origin: PROD, userId: "user_1" }, env);

    expect(await adoptLegacyData(target, env)).toBe(true);
    expect(await readFile(join(target, "workspace.sqlite"), "utf8")).toBe("database");
    expect(await readFile(join(target, "workspace.sqlite-wal"), "utf8")).toBe("wal");
    // Agent credentials follow the account that owned them.
    expect(await readFile(join(target, "providers", "anthropic.json"), "utf8")).toBe("credential");
    expect(existsSync(join(dir, "workspace.sqlite"))).toBe(false);
  });

  it("leaves a second account empty instead of handing it the first account's data", async () => {
    const dir = await base();
    await legacyInstall(dir);
    const env = { CONCORS_DATA_DIR: dir };
    const first = profileDir({ origin: PROD, userId: "user_1" }, env);
    expect(await adoptLegacyData(first, env)).toBe(true);

    const second = profileDir({ origin: PROD, userId: "user_2" }, env);
    expect(await adoptLegacyData(second, env)).toBe(false);
    expect(existsSync(second)).toBe(false);
  });

  it("never runs twice for the same profile", async () => {
    const dir = await base();
    await legacyInstall(dir);
    const env = { CONCORS_DATA_DIR: dir };
    const target = profileDir({ origin: PROD, userId: "user_1" }, env);

    expect(await adoptLegacyData(target, env)).toBe(true);
    await writeFile(join(target, "workspace.sqlite"), "changed since adoption");
    expect(await adoptLegacyData(target, env)).toBe(false);
    expect(await readFile(join(target, "workspace.sqlite"), "utf8")).toBe("changed since adoption");
  });

  it("does nothing for a fresh install with no legacy database", async () => {
    const dir = await base();
    const env = { CONCORS_DATA_DIR: dir };
    const target = profileDir({ origin: PROD, userId: "user_1" }, env);

    expect(await adoptLegacyData(target, env)).toBe(false);
    expect(existsSync(target)).toBe(false);
  });

  it("keeps development and production data apart", async () => {
    const dir = await base();
    await legacyInstall(dir);
    const env = { CONCORS_DATA_DIR: dir };
    const prod = profileDir({ origin: PROD, userId: "user_1" }, env);
    const dev = profileDir({ origin: "http://localhost:3000", userId: "user_1" }, env);

    expect(await adoptLegacyData(prod, env)).toBe(true);
    expect(await adoptLegacyData(dev, env)).toBe(false);
    expect(prod).not.toBe(dev);
  });
});
