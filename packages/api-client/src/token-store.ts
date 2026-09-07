/**
 * Where the session token lives between requests.
 *
 * The token is the user's credential for the control plane, so hosts decide how to keep it: the
 * desktop app uses webview storage today, a keychain-backed store later, React Native its secure
 * store. The client only ever calls `get` before a request and `set` after sign-in / sign-out.
 */
export interface TokenStore {
  get(): string | null;
  set(token: string | null): void;
}

/** Keeps the token in memory only; it is gone when the page or process ends. */
export function memoryTokenStore(initial: string | null = null): TokenStore {
  let token = initial;
  return {
    get: () => token,
    set: (next) => {
      token = next;
    },
  };
}
