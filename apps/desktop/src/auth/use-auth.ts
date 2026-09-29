import type { ApiClient, NativeSignInChoice } from "@concors/api-client";
import { useCallback, useEffect, useRef, useState } from "react";

import { clearApiCache } from "@/data/api-resource";

import { interpretProbe, type AuthState, type SessionProbe } from "./auth-state.ts";
import { signInWithBrowser } from "./sign-in.ts";

export interface Auth {
  readonly state: AuthState;
  /** Re-checks the session with the API. Resolves to the resulting state. */
  refresh(): Promise<AuthState>;
  /**
   * Signs in, or creates an account, with the chosen method on the API's sign-in page in the system
   * browser. Native app only.
   */
  signIn(choice: NativeSignInChoice, signal?: AbortSignal): Promise<void>;
  signOut(): Promise<void>;
  setActiveOrganization(organizationId: string): Promise<void>;
}

/**
 * Account session of the app.
 *
 * On mount the saved session (if any) is checked against the API. Every action re-checks the
 * session afterwards so `state` always mirrors what the API believes. Results of superseded checks
 * are discarded (e.g. a slow startup check finishing after the user already signed out).
 */
export function useAuth(api: ApiClient): Auth {
  const [state, setState] = useState<AuthState>({ status: "restoring" });
  const generation = useRef(0);

  const refresh = useCallback(async (): Promise<AuthState> => {
    const ticket = ++generation.current;
    const hadToken = api.tokens.get() !== null;
    const probe = await probeSession(api);
    const { state: next, dropToken } = interpretProbe(probe, hadToken);
    if (ticket !== generation.current) return next;
    if (dropToken) {
      api.tokens.set(null);
      clearApiCache();
    }
    setState(next);
    return next;
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (choice: NativeSignInChoice, signal?: AbortSignal) => {
      await signInWithBrowser(api, choice, signal);
      const next = await refresh();
      if (next.status !== "signed-in") throw new Error(sessionNotAccepted(next));
    },
    [api, refresh],
  );

  const signOut = useCallback(async () => {
    generation.current++;
    clearApiCache();
    setState({ status: "signed-out" });
    try {
      await api.signOut();
    } catch {
      // The local session is gone either way; revoking on the server is retried next sign-in.
    }
  }, [api]);

  const setActiveOrganization = useCallback(
    async (organizationId: string) => {
      await api.setActiveOrganization(organizationId);
      await refresh();
    },
    [api, refresh],
  );

  return { state, refresh, signIn, signOut, setActiveOrganization };
}

async function probeSession(api: ApiClient): Promise<SessionProbe> {
  try {
    const me = await api.getMe();
    // Organizations are decoration on top of the session; failing to load them is not a sign-out.
    const organizations = await api.listOrganizations().catch(() => []);
    return { kind: "ok", me, organizations };
  } catch (error) {
    return { kind: "failed", error };
  }
}

function sessionNotAccepted(state: AuthState): string {
  return state.status === "unavailable"
    ? state.message
    : "Signed in, but the API did not accept the new session. If you are running a native build, the server needs bearer-token support (see docs/auth.md).";
}
