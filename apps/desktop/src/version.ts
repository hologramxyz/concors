import pkg from "../package.json" with { type: "json" };

/** Version reported to daemons during the handshake. Kept in sync with `src-tauri/tauri.conf.json`. */
export const APP_VERSION: string = pkg.version;
