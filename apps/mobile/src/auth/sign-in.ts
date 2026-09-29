import type { ApiClient } from "@concors/api-client";
import {
  CANCELLED_SIGN_IN_CODES,
  base64url,
  describeSignInError,
  parseSignInCallback,
  verifierFromBytes,
} from "@concors/client-core";

/**
 * Sign-in on mobile (RFC 8252 §7.1). An in-app authentication session — ASWebAuthenticationSession
 * on iOS, Custom Tabs on Android — opens the API's sign-in page (GitHub, Google or an emailed code)
 * and hands the redirect to this app's URL scheme straight back to the caller. The one-time code in
 * it is redeemed with a PKCE verifier that never leaves this process, so another app claiming the
 * same scheme could not use a code even if it saw one.
 *
 * Platform APIs arrive through `SignInPlatform` so this module stays testable without Expo.
 */

export interface SignInPlatform {
  /** This build's URL scheme; the API only returns to the allowlisted Concors schemes. */
  readonly scheme: string;
  randomBytes(count: number): Uint8Array;
  sha256(input: string): Promise<Uint8Array>;
  openAuthSession(url: string, redirectUrl: string): Promise<{ type: string; url?: string }>;
}

export type SignInOutcome = "signed-in" | "cancelled";

export class SignInError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SignInError";
    this.code = code;
  }
}

/** Resolves `"cancelled"` when the person closes the sheet or cancels on the sign-in page. */
export async function signInWithAuthSession(
  api: ApiClient,
  platform: SignInPlatform,
): Promise<SignInOutcome> {
  const verifier = verifierFromBytes(platform.randomBytes(32));
  const challenge = base64url(await platform.sha256(verifier));
  const redirectUrl = `${platform.scheme}://native-auth/callback`;
  const session = await platform.openAuthSession(
    api.nativeSignInUrl({ app: platform.scheme }, challenge),
    redirectUrl,
  );
  if (session.type !== "success" || session.url === undefined) return "cancelled";
  // Only a redirect to our own callback counts, never some other URL the session ended on.
  if (!session.url.startsWith(`${redirectUrl}?`)) return "cancelled";

  const result = parseSignInCallback(session.url);
  if (result.kind === "error") {
    if (CANCELLED_SIGN_IN_CODES.has(result.error)) return "cancelled";
    throw new SignInError(result.error, describeSignInError(result.error));
  }
  await api.completeNativeSignIn({ code: result.code, verifier });
  return "signed-in";
}
