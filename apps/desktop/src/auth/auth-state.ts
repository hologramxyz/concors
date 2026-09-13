import {
  ApiError,
  ApiNetworkError,
  type ApiSession,
  type ApiUser,
  type Me,
  type Organization,
} from "@concors/api-client";

/**
 * Account state of the app. The app is gated behind it: nothing but the sign-in screen renders
 * until the state is `signed-in`. `restoring` is the moment at startup where a saved session is
 * checked against the API.
 */
export type AuthState =
  | { readonly status: "restoring" }
  | { readonly status: "signed-out" }
  | {
      readonly status: "signed-in";
      readonly user: ApiUser;
      readonly session: ApiSession;
      readonly organizations: readonly Organization[];
    }
  | {
      /** A saved session exists but could not be checked (API unreachable or failing). */
      readonly status: "unavailable";
      readonly message: string;
    };

export type SignedInAuth = Extract<AuthState, { status: "signed-in" }>;

export type SessionProbe =
  | { readonly kind: "ok"; readonly me: Me; readonly organizations: readonly Organization[] }
  | { readonly kind: "failed"; readonly error: unknown };

/**
 * Turns the outcome of a session check into an `AuthState`.
 *
 * A 401 means the session is gone for good, so the saved token must be dropped. Any other failure
 * keeps the token: the API may simply be down, and the sign-in screen offers a retry. Without a
 * saved token a failure is unremarkable and simply reads as signed-out.
 */
export function interpretProbe(
  probe: SessionProbe,
  hadToken: boolean,
): { readonly state: AuthState; readonly dropToken: boolean } {
  if (probe.kind === "ok") {
    return {
      state: {
        status: "signed-in",
        user: probe.me.user,
        session: probe.me.session,
        organizations: probe.organizations,
      },
      dropToken: false,
    };
  }
  if (probe.error instanceof ApiError && probe.error.unauthorized) {
    return { state: { status: "signed-out" }, dropToken: true };
  }
  if (!hadToken) return { state: { status: "signed-out" }, dropToken: false };
  return {
    state: { status: "unavailable", message: describeAuthError(probe.error) },
    dropToken: false,
  };
}

const CODE_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Incorrect email or password.",
  USER_ALREADY_EXISTS: "An account with this email already exists. Sign in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    "An account with this email already exists. Sign in instead.",
  INVALID_EMAIL: "Enter a valid email address.",
  PASSWORD_TOO_SHORT: "Password must be at least 8 characters.",
  PASSWORD_TOO_LONG: "That password is too long.",
  EMAIL_NOT_VERIFIED: "Verify your email address before signing in.",
  INVALID_RESPONSE: "The API answered in an unexpected format. It may be a newer or older version.",
};

/** Human-readable message for anything thrown by `@concors/api-client`. */
export function describeAuthError(error: unknown): string {
  if (error instanceof ApiNetworkError) {
    return "Can't reach the Concourse API. Check your connection and try again.";
  }
  if (error instanceof ApiError) {
    const known = error.code === undefined ? undefined : CODE_MESSAGES[error.code];
    if (known !== undefined) return known;
    if (error.status >= 500) return "The Concourse API is having trouble. Try again in a moment.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** The organization the session currently acts within, if we know it. */
export function activeOrganization(state: SignedInAuth): Organization | undefined {
  return state.organizations.find((org) => org.id === state.session.activeOrganizationId);
}

/** Single letter for the avatar placeholder. */
export function initialOf(user: Pick<ApiUser, "name" | "email">): string {
  const source = user.name.trim() || user.email;
  return (source[0] ?? "?").toUpperCase();
}
