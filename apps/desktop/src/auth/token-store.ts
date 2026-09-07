import type { TokenStore } from "@concors/api-client";

export const SESSION_TOKEN_STORAGE_KEY = "concors.auth.session-token.v1";

/**
 * Keeps the control-plane session token in webview storage so the user stays signed in across
 * launches. Falls back to memory when storage is unavailable (restrictive webview, private mode).
 *
 * Hardening planned for the packaged app: a keychain-backed store exposed through `src/tauri/`,
 * behind this same `TokenStore` interface.
 */
export function webStorageTokenStore(
  storage: Storage | null = defaultStorage(),
  key: string = SESSION_TOKEN_STORAGE_KEY,
): TokenStore {
  let memory: string | null = null;
  return {
    get: () => {
      if (storage === null) return memory;
      try {
        return storage.getItem(key);
      } catch {
        return memory;
      }
    },
    set: (token) => {
      memory = token;
      if (storage === null) return;
      try {
        if (token === null) storage.removeItem(key);
        else storage.setItem(key, token);
      } catch {
        // Storage may refuse writes (quota, private mode); the in-memory copy still works this session.
      }
    },
  };
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
