import type { ApiClient } from "@concors/api-client";
import {
  CANCELLED_SIGN_IN_CODES,
  base64url,
  describeGitHubSignInError,
  verifierFromBytes,
} from "@concors/client-core";
import { useEffect, useState } from "react";

import { isTauri, openExternal, startSignInListener, type SignInListener } from "@/tauri";

/**
 * Sign in with GitHub from the native app, following RFC 8252: the system browser runs the OAuth
 * flow, the control plane redirects a one-time code to a loopback port on this machine, and the
 * code is redeemed with a PKCE verifier that never leaves this process.
 *
 * The browser is used rather than an embedded webview so users authenticate on a page they can
 * trust (and where password managers and passkeys work), and so this app never sees their GitHub
 * credentials. See concors-server `docs/github-sign-in.md` for the server half.
 */

export interface GitHubSignInDependencies {
  startListener(): Promise<SignInListener>;
  openExternal(url: string): Promise<void>;
}

const nativeDependencies: GitHubSignInDependencies = {
  startListener: startSignInListener,
  openExternal,
};

export class GitHubSignInError extends Error {
  readonly code: string;
  /** The person stopped on purpose (cancelled here, or denied on GitHub); not worth an error. */
  get cancelled(): boolean {
    return CANCELLED_SIGN_IN_CODES.has(this.code);
  }

  constructor(code: string, message: string) {
    super(message);
    this.name = "GitHubSignInError";
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
 * Runs one GitHub sign-in to completion. On success the session token is stored in `api.tokens`;
 * the caller re-checks the session. Aborting `signal` stops listening and rejects as cancelled.
 */
export async function signInWithGitHub(
  api: ApiClient,
  signal?: AbortSignal,
  dependencies: GitHubSignInDependencies = nativeDependencies,
): Promise<void> {
  const verifier = createVerifier();
  const challenge = await challengeFor(verifier);
  const listener = await dependencies.startListener();
  const abort = () => listener.cancel();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) listener.cancel();
    await dependencies.openExternal(api.nativeGitHubSignInUrl({ port: listener.port }, challenge));
    const result = await listener.result;
    if (result.kind === "error")
      throw new GitHubSignInError(result.error, describeGitHubSignInError(result.error));
    await api.completeNativeSignIn({ code: result.code, verifier });
  } finally {
    signal?.removeEventListener("abort", abort);
    listener.cancel();
  }
}

/**
 * Whether to offer GitHub sign-in: only in the native app (the loopback redirect needs it) and only
 * when the API reports the provider configured, so an environment without credentials never shows
 * a button that leads to an error page. Unknown until the API answers, and `false` if it cannot.
 */
export function useGitHubSignInAvailable(api: ApiClient): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let current = true;
    api
      .getSignInProviders()
      .then((providers) => {
        if (current) setAvailable(providers.github);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [api]);
  return available;
}
