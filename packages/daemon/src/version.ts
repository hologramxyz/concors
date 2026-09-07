import pkg from "../package.json" with { type: "json" };

/**
 * Version of this daemon build. Inlined from package.json at bundle time, so it stays correct in a
 * standalone executable where no package.json exists on disk.
 */
export const DAEMON_VERSION: string = pkg.version;
