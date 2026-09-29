/**
 * Shared pieces of browser sign-in for the desktop and mobile apps. The API's sign-in page offers
 * GitHub, Google and an emailed code; each app owns only how the result gets back to it — a
 * loopback port on desktop, an authentication session on mobile — and both parse and explain
 * results here, so a given outcome reads the same everywhere.
 *
 * Written without `URL`, `URLSearchParams` or `btoa`, whose React Native implementations are
 * incomplete or engine-dependent.
 */

/** 256 random bits in base64url: the shape of a sign-in code minted by the API. */
export const SIGN_IN_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** Callback error codes are lowercase identifiers. */
const ERROR_CODE_PATTERN = /^[a-z_]{1,64}$/;

export type SignInCallback =
  | { readonly kind: "code"; readonly code: string }
  | { readonly kind: "error"; readonly error: string };

/** Codes that mean the person chose to stop; clients show no error for these. */
export const CANCELLED_SIGN_IN_CODES: ReadonlySet<string> = new Set(["cancelled", "access_denied"]);

const MESSAGES: Readonly<Record<string, string>> = {
  access_denied: "Sign-in was cancelled.",
  cancelled: "Sign-in was cancelled.",
  // Accounts are keyed by a verified email, so a sign-in without one cannot be matched or created.
  email_required:
    "This account has no verified email address. Sign in with email, Google, or a GitHub account with a verified email.",
};

export function describeSignInError(code: string): string {
  return MESSAGES[code] ?? "Sign-in did not complete. Try again.";
}

/**
 * Reads `code` or `error` from a callback URL or bare query string. Only the shapes the API produces
 * are accepted; anything else becomes a generic failure, so nothing unexpected reaches the UI.
 */
export function parseSignInCallback(urlOrQuery: string): SignInCallback {
  const withoutFragment = urlOrQuery.split("#")[0] ?? "";
  const query = withoutFragment.includes("?")
    ? withoutFragment.slice(withoutFragment.indexOf("?") + 1)
    : withoutFragment;
  const values = new Map<string, string>();
  for (const pair of query.split("&")) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    try {
      values.set(
        decodeURIComponent(pair.slice(0, index)),
        decodeURIComponent(pair.slice(index + 1)),
      );
    } catch {
      // Malformed escapes are ignored rather than trusted.
    }
  }
  const code = values.get("code");
  if (code !== undefined && SIGN_IN_CODE_PATTERN.test(code)) return { kind: "code", code };
  const error = values.get("error");
  return {
    kind: "error",
    error: error !== undefined && ERROR_CODE_PATTERN.test(error) ? error : "sign_in_failed",
  };
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url, as used by PKCE (RFC 7636). */
export function base64url(bytes: Uint8Array): string {
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const remaining = Math.min(3, bytes.length - i);
    const chunk = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    // One input byte yields two characters, two yield three, three yield four.
    for (let slot = 0; slot <= remaining; slot++)
      output += ALPHABET.charAt((chunk >> (18 - 6 * slot)) & 63);
  }
  return output;
}

/** PKCE verifier from 32 random bytes supplied by the platform: 43 characters, the RFC minimum. */
export function verifierFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error("A PKCE verifier needs exactly 32 random bytes");
  return base64url(bytes);
}
