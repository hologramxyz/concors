import { ApiError, type SshKey } from "@concors/api-client";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/auth/api";
import { useSshKeys } from "@/data/ssh-keys";
import { deviceSshKey, isTauri, type DeviceSshKey } from "@/tauri";

import { describeMachinesError } from "./use-machines.ts";

/**
 * SSH access from this computer's own terminal. Concors manages machines with its own key, so
 * nothing here is needed to use a machine in the app; it only matters for plain `ssh`.
 *
 * The desktop app creates one key per device on request and registers its public half. The server
 * pushes registered keys to running machines within seconds. Browser and mobile builds cannot hold
 * a private key, so they only show a command when the person already added a key of their own.
 */

/** Compares public keys by type and data, ignoring comments. */
export function sameSshKey(a: string, b: string): boolean {
  const essential = (key: string) => key.trim().split(/\s+/).slice(0, 2).join(" ");
  return essential(a) === essential(b);
}

export interface RegisterDeviceKeyDependencies {
  createKey(): Promise<DeviceSshKey>;
  listKeys(): Promise<SshKey[]>;
  addKey(input: { name: string; publicKey: string }): Promise<SshKey>;
}

export type DeviceKeyRegistration =
  | { readonly kind: "added"; readonly key: DeviceSshKey; readonly sshKey: SshKey }
  | { readonly kind: "already-registered"; readonly key: DeviceSshKey };

/**
 * Creates this computer's key if needed and registers it once. A concurrent registration from
 * another window surfaces as a conflict, which counts as success when the key now shows up among
 * this person's keys.
 */
export async function registerDeviceKey(
  dependencies: RegisterDeviceKeyDependencies,
): Promise<DeviceKeyRegistration> {
  const key = await dependencies.createKey();
  const isThisKey = (candidate: SshKey) => sameSshKey(candidate.publicKey, key.publicKey);
  if ((await dependencies.listKeys()).some(isThisKey)) return { kind: "already-registered", key };
  try {
    const sshKey = await dependencies.addKey({ name: key.deviceName, publicKey: key.publicKey });
    return { kind: "added", key, sshKey };
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 409 &&
      (await dependencies.listKeys()).some(isThisKey)
    )
      return { kind: "already-registered", key };
    throw error;
  }
}

export interface DeviceSsh {
  /** `true` in the desktop app, which can create a key on this computer. */
  readonly supported: boolean;
  /** This computer's key once it exists. */
  readonly key: DeviceSshKey | null;
  /** This computer's key is registered, so machines accept it. */
  readonly registered: boolean;
  /** The person has at least one registered key of any kind. */
  readonly hasKeys: boolean;
  /** Registered during this visit: it may take a few seconds to reach running machines. */
  readonly justRegistered: boolean;
  readonly settingUp: boolean;
  readonly error: string | null;
  setUp(): void;
}

function describe(cause: unknown): string {
  // Native commands reject with plain strings.
  return typeof cause === "string" ? cause : describeMachinesError(cause);
}

export function useDeviceSsh(organizationId: string | undefined): DeviceSsh {
  const supported = isTauri();
  const keys = useSshKeys(organizationId);
  const [key, setKey] = useState<DeviceSshKey | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    let current = true;
    // Only looks: nothing is written to ~/.ssh until someone asks to set up SSH.
    deviceSshKey
      .find()
      .then((found) => {
        if (current) setKey(found);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [supported]);

  const { resource, refresh } = keys;
  const setUp = useCallback(() => {
    const scope = organizationId === undefined ? {} : { organizationId };
    setSettingUp(true);
    setError(null);
    void registerDeviceKey({
      createKey: deviceSshKey.create,
      listKeys: () => api.listSshKeys(scope),
      addKey: (input) => api.addSshKey({ ...scope, ...input }),
    })
      .then(async (result) => {
        setKey(result.key);
        if (result.kind === "added") {
          resource.set((current) => [...(current ?? []), result.sshKey]);
          setJustRegistered(true);
        } else await refresh();
      })
      .catch((cause: unknown) => setError(describe(cause)))
      .finally(() => setSettingUp(false));
  }, [organizationId, resource, refresh]);

  const list = keys.data ?? [];
  return {
    supported,
    key,
    registered:
      key !== null && list.some((candidate) => sameSshKey(candidate.publicKey, key.publicKey)),
    hasKeys: list.length > 0,
    justRegistered,
    settingUp,
    error,
    setUp,
  };
}
