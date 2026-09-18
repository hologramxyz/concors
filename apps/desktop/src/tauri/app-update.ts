import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

/*
 * Wrapper around `src-tauri/src/update.rs`: how this copy of Concors was installed, and replacing
 * it with a newer published build. The webview decides whether to offer an update; the native side
 * is what can actually write to the installation.
 */

const InstallationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pacman"), package: z.string() }),
  z.object({ kind: z.literal("tarball"), root: z.string(), writable: z.boolean() }),
  z.object({ kind: z.literal("development") }),
  z.object({ kind: z.literal("unknown") }),
]);

const InstallationReportSchema = z.intersection(
  InstallationSchema,
  z.object({
    formats: z.array(z.string()),
    /** `linux`, `darwin` or `windows`, as the control plane names them. */
    platform: z.string(),
    arch: z.string(),
  }),
);

export type Installation = z.infer<typeof InstallationSchema>;
export type InstallationReport = z.infer<typeof InstallationReportSchema>;

export interface InstallUpdateInput {
  readonly url: string;
  readonly sha256: string;
  /** Published size, which lets the native side tell a short download from a wrong one. */
  readonly size: number;
  readonly format: string;
  /** Session token; the control plane serves builds only to signed-in clients. */
  readonly token: string;
  readonly version: string;
}

export const appUpdate = {
  /** How this copy was installed, and which release formats it can apply. */
  installation: async (): Promise<InstallationReport> =>
    InstallationReportSchema.parse(await invoke("app_installation")),
  /**
   * Downloads the build, checks it against its digest, installs it and restarts into it. On
   * success the window closes as the app relaunches, so nothing after this runs.
   */
  install: async (input: InstallUpdateInput): Promise<void> => {
    await invoke("install_app_update", { request: input });
  },
} as const;
