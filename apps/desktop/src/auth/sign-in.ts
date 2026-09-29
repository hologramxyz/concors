import type { ApiClient } from "@concors/api-client";
import {
  CANCELLED_SIGN_IN_CODES,
  base64url,
  describeSignInError,
  verifierFromBytes,
} from "@concors/client-core";
import { useEffect, useState } from "react";

import { isTauri, openExternal, startSignInListener, type SignInListener } from "@/tauri";

/**
 * Sign-in from the native app, following RFC 8252: the system browser opens the API's sign-in page
 * (GitHub, Google or an emailed code), the control plane redirects a one-time code to a loopback
 * port on this machine, and the code is redeemed with a PKCE verifier that never leaves this
 * process.
 *
 * The browser is used rather than an embedded webview so users authenticate on a page they can
 * trust (where password managers and passkeys work), and so this app never sees their credentials.
 */

export interface SignInDependencies {
  startListener(): Promise<SignInListener>;
  openExternal(url: string): Promise<void>;
}

const nativeDependencies: SignInDependencies = {
  startListener: startSignInListener,
  openExternal,
};

export class SignInError extends Error {
  readonly code: string;
  /** The person stopped on purpose (cancelled here, or on the sign-in page); not worth an error. */
  get cancelled(): boolean {
    return CANCELLED_SIGN_IN_CODES.has(this.code);
  }

  constructor(code: string, message: string) {
    super(message);
    this.name = "SignInError";
    this.code = code;
  }
}

/** 256 random bits: 43 base64url characters, the RFC 7636 minimum length. */
export function createVerifier(): string {
  return verifierFromBytes(crypto.getRandomValues(new Uint8Array(32)));
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/**
 * Runs one browser sign-in to completion. On success the session token is stored in `api.tokens`;
 * the caller re-checks the session. Aborting `signal` stops listening and rejects as cancelled.
 */
export async function signInWithBrowser(
  api: ApiClient,
  signal?: AbortSignal,
  dependencies: SignInDependencies = nativeDependencies,
): Promise<void> {
  const verifier = createVerifier();
  const challenge = await challengeFor(verifier);
  const listener = await dependencies.startListener();
  const abort = () => listener.cancel();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) listener.cancel();
    await dependencies.openExternal(api.nativeSignInUrl({ port: listener.port }, challenge));
    const result = await listener.result;
    if (result.kind === "error")
      throw new SignInError(result.error, describeSignInError(result.error));
    await api.completeNativeSignIn({ code: result.code, verifier });
  } finally {
    signal?.removeEventListener("abort", abort);
    listener.cancel();
  }
}

/**
 * Why sign-in cannot be offered right now, or `null` when it can. The loopback redirect needs the
 * native app, so a browser preview explains that instead. In the app, only an explicit answer that
 * the API has no sign-in method configured hides the button: while the check is pending, or if it
 * fails, the page itself is the better place to find out.
 */
export function useSignInUnavailable(api: ApiClient): string | null {
  const [configured, setConfigured] = useState(true);
  useEffect(() => {
    if (!isTauri()) return;
    let current = true;
    api
      .getSignInProviders()
      .then((providers) => {
        if (current) setConfigured(providers.github || providers.google || providers.email);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [api]);
  if (!isTauri())
    return "Signing in opens your browser, which only the Concors desktop app can do. Open the app to sign in.";
  return configured ? null : "Sign-in is not set up on this Concors server yet.";
}
