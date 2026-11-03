/**
 * Whose data the local runtime keeps when nobody is signed in. The desktop app starts the runtime
 * with it and the daemon moves that data to the first account to sign in. It selects a folder and
 * proves nothing: see `packages/daemon/src/profile.ts`.
 */
export const GUEST_PROFILE_USER = "local-guest";
