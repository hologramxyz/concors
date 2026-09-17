import { ApiError, type SshKey } from "@concors/api-client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/tauri", () => ({ isTauri: () => true, deviceSshKey: {} }));
vi.mock("@/auth/api", () => ({ api: {} }));

import { registerDeviceKey, sameSshKey, type RegisterDeviceKeyDependencies } from "./device-ssh.ts";

const DEVICE = {
  publicKey: "ssh-ed25519 AAAAdevice",
  path: "/home/ada/.ssh/concors_ed25519",
  deviceName: "ada-laptop",
};

function registered(publicKey: string, name = "ada-laptop"): SshKey {
  return {
    id: `key-${name}`,
    organizationId: "org",
    createdByUserId: "ada",
    name,
    type: "ssh-ed25519",
    publicKey,
    fingerprint: "SHA256:x",
    createdAt: "2026-09-16T00:00:00.000Z",
  } as SshKey;
}

function dependencies(overrides: Partial<RegisterDeviceKeyDependencies> = {}) {
  return {
    createKey: vi.fn(async () => DEVICE),
    listKeys: vi.fn(async () => [] as SshKey[]),
    addKey: vi.fn(async (input: { name: string; publicKey: string }) =>
      registered(input.publicKey, input.name),
    ),
    ...overrides,
  };
}

describe("sameSshKey", () => {
  it("ignores comments and surrounding whitespace", () => {
    expect(sameSshKey("ssh-ed25519 AAAA ada@laptop", " ssh-ed25519 AAAA\n")).toBe(true);
    expect(sameSshKey("ssh-ed25519 AAAA", "ssh-ed25519 BBBB")).toBe(false);
    expect(sameSshKey("ssh-rsa AAAA", "ssh-ed25519 AAAA")).toBe(false);
  });
});

describe("registerDeviceKey", () => {
  it("registers this computer's key under the device name", async () => {
    const deps = dependencies();
    const result = await registerDeviceKey(deps);
    expect(result.kind).toBe("added");
    expect(deps.addKey).toHaveBeenCalledWith({ name: "ada-laptop", publicKey: DEVICE.publicKey });
  });

  it("registers nothing when the key is already on the account", async () => {
    const deps = dependencies({
      listKeys: vi.fn(async () => [registered("ssh-ed25519 AAAAdevice concors@ada-laptop")]),
    });
    expect((await registerDeviceKey(deps)).kind).toBe("already-registered");
    expect(deps.addKey).not.toHaveBeenCalled();
  });

  it("treats a conflict as success once the key shows up among this person's keys", async () => {
    const listKeys = vi
      .fn<() => Promise<SshKey[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([registered(DEVICE.publicKey, "other window")]);
    const deps = dependencies({
      listKeys,
      addKey: vi.fn(async () => {
        throw new ApiError(409, "This key is already registered");
      }),
    });
    expect((await registerDeviceKey(deps)).kind).toBe("already-registered");
  });

  it("reports a conflict when the key belongs to someone else", async () => {
    const deps = dependencies({
      addKey: vi.fn(async () => {
        throw new ApiError(409, 'This key is already registered as "shared"');
      }),
    });
    await expect(registerDeviceKey(deps)).rejects.toThrow("already registered");
  });

  it("stops before registering when the key cannot be created", async () => {
    const deps = dependencies({
      createKey: vi.fn(async () => {
        throw "OpenSSH is not installed on this computer.";
      }),
    });
    await expect(registerDeviceKey(deps)).rejects.toBe(
      "OpenSSH is not installed on this computer.",
    );
    expect(deps.addKey).not.toHaveBeenCalled();
  });
});
