import type { DesktopUpdate } from "@concors/api-client";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/auth/api";
import { appUpdate, type InstallationReport } from "@/tauri";
import { APP_VERSION } from "@/version";

/**
 * Knowing a newer Concors exists, and replacing this one with it.
 *
 * What the app can do about an update depends entirely on how this copy was installed, which the
 * native side reports (`src-tauri/src/update.rs`). A package under `/opt` is applied through the
 * system package manager and needs an administrator; a tree the person unpacked themselves we can
 * replace; a build from a checkout is left alone, because the checkout is the source of truth.
 *
 * Where nothing can be applied the badge still appears: being told a new version exists is the
 * part that matters, and it is better than silence.
 */

/** How often a running app looks again. Releases are rare; this is a background courtesy. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type AppUpdateState =
  | { readonly kind: "none" }
  | { readonly kind: "available"; readonly update: DesktopUpdate; readonly installable: boolean }
  | { readonly kind: "installing"; readonly update: DesktopUpdate }
  | {
      readonly kind: "failed";
      readonly update: DesktopUpdate;
      readonly installable: boolean;
      readonly message: string;
    };

/**
 * What to ask the control plane for, given how this copy was installed. An installation we cannot
 * write to is still asked about — with the format anyone can use — so the person is told, and the
 * answer is marked as something to act on themselves.
 */
export function updateQuery(report: InstallationReport): {
  formats: readonly string[];
  installable: boolean;
} {
  if (report.kind === "development") return { formats: [], installable: false };
  if (report.formats.length > 0) return { formats: report.formats, installable: true };
  return { formats: ["tarball"], installable: false };
}

export interface AppUpdateDependencies {
  installation(): Promise<InstallationReport>;
  check(input: {
    version: string;
    platform: string;
    arch: string;
    formats: readonly string[];
  }): Promise<DesktopUpdate | null>;
  install(input: {
    url: string;
    sha256: string;
    format: string;
    token: string;
    version: string;
  }): Promise<void>;
  /** The session token; builds are served only to signed-in clients. */
  token(): string | null;
  version?: string;
}

/** The update this copy should be told about, or `null`. Never throws: a failed check is silence. */
export async function findUpdate(
  dependencies: AppUpdateDependencies,
): Promise<{ update: DesktopUpdate; installable: boolean } | null> {
  try {
    const report = await dependencies.installation();
    const { formats, installable } = updateQuery(report);
    if (formats.length === 0) return null;
    const update = await dependencies.check({
      version: dependencies.version ?? APP_VERSION,
      platform: report.platform,
      arch: report.arch,
      formats,
    });
    return update ? { update, installable } : null;
  } catch {
    // The control plane being unreachable is not something to interrupt anyone about.
    return null;
  }
}

/** Human wording for why an update could not be applied. */
export function describeUpdateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() || "The update could not be installed.";
}

/**
 * Installs the update. On success the app restarts and this never returns, so callers should treat
 * a returned value as an unexpected outcome rather than as completion.
 */
export async function applyUpdate(
  dependencies: AppUpdateDependencies,
  update: DesktopUpdate,
): Promise<void> {
  const token = dependencies.token();
  if (!token) throw new Error("Sign in to download this update.");
  await dependencies.install({
    url: update.url,
    sha256: update.sha256,
    format: update.format,
    token,
    version: update.version,
  });
}

const liveDependencies: AppUpdateDependencies = {
  installation: () => appUpdate.installation(),
  check: (input) => api.getDesktopUpdate(input),
  install: (input) => appUpdate.install(input),
  token: () => api.tokens.get(),
};

export interface AppUpdateControls {
  readonly state: AppUpdateState;
  /** Starts the install; the app restarts into the new build when it succeeds. */
  install(): Promise<void>;
}

/**
 * Checks once on mount and every few hours after that. `dependencies` defaults to a module
 * constant, so the schedule is set up once; a caller passing a fresh object each render would
 * restart it each time.
 */
export function useAppUpdate(
  dependencies: AppUpdateDependencies = liveDependencies,
): AppUpdateControls {
  const [state, setState] = useState<AppUpdateState>({ kind: "none" });

  useEffect(() => {
    let cancelled = false;
    const look = async () => {
      const found = await findUpdate(dependencies);
      if (cancelled) return;
      // An install in progress must not be replaced by a check that finished late.
      setState((current) =>
        current.kind === "installing"
          ? current
          : found
            ? { kind: "available", update: found.update, installable: found.installable }
            : { kind: "none" },
      );
    };
    void look();
    const timer = setInterval(() => void look(), CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [dependencies]);

  const install = useCallback(async () => {
    const current = state;
    if (current.kind !== "available" && current.kind !== "failed") return;
    if (!current.installable) return;
    setState({ kind: "installing", update: current.update });
    try {
      await applyUpdate(dependencies, current.update);
      // Reached only if the app did not restart; the update did not take effect.
      setState({
        kind: "failed",
        update: current.update,
        installable: current.installable,
        message: "Concors could not restart into the new version.",
      });
    } catch (error) {
      setState({
        kind: "failed",
        update: current.update,
        installable: current.installable,
        message: describeUpdateError(error),
      });
    }
  }, [dependencies, state]);

  return { state, install };
}
