import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, type Me } from "@concors/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { AppState } from "react-native";
import { api } from "./runtime";
import { tokenStore, machineCredentials } from "../platform/storage";
import { disablePush } from "../platform/notifications";
import { config } from "../config";
import { useDirectProfile } from "./profile-sheet";
import { nativeGitHubPlatform } from "./github-platform";
import { GitHubSignInError, signInWithGitHub as runGitHubSignIn } from "./github-sign-in";
import { useSignInProviders } from "./use-sign-in-providers";

interface AuthState {
  me: Me | null;
  loading: boolean;
  error: string | null;
}
interface AuthContextValue extends AuthState {
  initializing: boolean;
  profile: ReturnType<typeof useDirectProfile>["profile"];
  openProfile(): void;
  direct: boolean;
  connectDirect(): void;
  signIn(email: string, password: string): Promise<void>;
  /** `true` once this build and the API both support GitHub sign-in. */
  githubSignIn: boolean;
  githubSignInChecking: boolean;
  githubSignInError: string | null;
  retryGitHubSignIn(): Promise<void>;
  /** Signs in, or creates an account, through GitHub in an in-app browser sheet. */
  signInWithGitHub(): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
  switchOrganization(organizationId: string): Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("Missing AuthProvider");
  return value;
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const profile = useDirectProfile();
  const query = useQueryClient();
  const generation = useRef(0);
  const changingSession = useRef(false);
  const [direct, setDirect] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [state, setState] = useState<AuthState>({ me: null, loading: true, error: null });
  const [github] = useState(() =>
    config.demo || config.developmentDaemon ? null : nativeGitHubPlatform(),
  );
  const githubProviders = useSignInProviders(!!github);
  const refresh = async () => {
    // A private-daemon test session is not a cloud login. Do not hydrate or send account tokens.
    if (config.developmentDaemon) {
      setState({ me: null, loading: false, error: null });
      return;
    }
    if (changingSession.current) return;
    const attempt = ++generation.current;
    try {
      await tokenStore.hydrate();
      await tokenStore.flush();
      const me = tokenStore.get() ? await api.getMe() : null;
      if (attempt === generation.current) setState({ me, loading: false, error: null });
    } catch (error) {
      if (attempt !== generation.current) return;
      if (error instanceof ApiError && error.status === 401) {
        tokenStore.set(null);
        await tokenStore.flush().catch(() => undefined);
        query.clear();
        setState({ me: null, loading: false, error: "Your session expired. Sign in again." });
      } else
        setState((current) => ({
          ...current,
          loading: false,
          error: "Could not verify your session. Check your connection and retry.",
        }));
    }
  };
  useEffect(() => {
    // Bootstrap reads SecureStore/network asynchronously; it does not derive render state.
    void machineCredentials
      .clear()
      .then(refresh)
      .catch(() => {
        setState({
          me: null,
          loading: false,
          error: "Could not clear saved machine access. Retry sign-out.",
        });
      })
      .finally(() => setInitializing(false));
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });
    // Invalidate pending authentication responses when the provider is removed.
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      subscription.remove();
    };
    // refresh intentionally reads the current store, not a render's auth state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const signIn = async (email: string, password: string) => {
    if (config.developmentDaemon) throw new Error("Cloud login is unavailable in direct mode.");
    if (changingSession.current) return;
    changingSession.current = true;
    const attempt = ++generation.current;
    setState({ me: null, loading: true, error: null });
    try {
      await tokenStore.hydrate();
      await api.signInWithEmail({ email: email.trim(), password });
      await tokenStore.flush();
      const me = await api.getMe();
      if (attempt === generation.current) {
        query.clear();
        setState({ me, loading: false, error: null });
      }
    } catch (error) {
      if (attempt !== generation.current) return;
      setState({
        me: null,
        loading: false,
        error:
          error instanceof ApiError && [400, 401].includes(error.status)
            ? "Email or password is incorrect."
            : "Could not sign in. Check your connection and try again.",
      });
    } finally {
      changingSession.current = false;
    }
  };
  const signInWithGitHub = async () => {
    if (!github) throw new Error("GitHub sign-in is not available in this build.");
    if (changingSession.current) return;
    changingSession.current = true;
    const attempt = ++generation.current;
    setState({ me: null, loading: true, error: null });
    try {
      await tokenStore.hydrate();
      const outcome = await runGitHubSignIn(api, github);
      if (outcome === "cancelled") {
        if (attempt === generation.current) setState({ me: null, loading: false, error: null });
        return;
      }
      await tokenStore.flush();
      const me = await api.getMe();
      if (attempt === generation.current) {
        query.clear();
        setState({ me, loading: false, error: null });
      }
    } catch (error) {
      if (attempt !== generation.current) return;
      setState({
        me: null,
        loading: false,
        error:
          error instanceof GitHubSignInError
            ? error.message
            : "Could not sign in with GitHub. Check your connection and try again.",
      });
    } finally {
      changingSession.current = false;
    }
  };
  const signOut = async () => {
    if (config.developmentDaemon) {
      generation.current++;
      setDirect(false);
      query.clear();
      setState({ me: null, loading: false, error: null });
      return;
    }
    if (changingSession.current) return;
    changingSession.current = true;
    generation.current++;
    // UI unmounts daemon subscriptions immediately. Cleanup retains the credential until revoked.
    setState({ me: null, loading: true, error: null });
    query.clear();
    let error: string | null = null;
    try {
      await disablePush(api);
    } catch {
      error =
        "Signed out locally, but notification cleanup needs a connection. Disable Concors notifications in device settings if necessary.";
    }
    try {
      await api.signOut();
    } catch {
      error = "Signed out on this device. Server revocation will require a connection.";
    }
    try {
      await machineCredentials.clear();
      await tokenStore.flush();
    } catch {
      error = "Could not remove the saved session. Retry sign-out before closing the app.";
    }
    setState({ me: null, loading: false, error });
    changingSession.current = false;
  };
  const switchOrganization = async (organizationId: string) => {
    if (direct || !state.me) throw new Error("Sign in to switch organizations");
    if (changingSession.current) throw new Error("Another account change is still in progress");
    if (organizationId === state.me.session.activeOrganizationId) return;
    changingSession.current = true;
    const attempt = ++generation.current;
    try {
      await api.setActiveOrganization(organizationId);
      if (attempt !== generation.current) return;
      // Only change local scope after the server accepts the switch. Updating it directly
      // avoids a failed follow-up /me leaving old UI attached to a new server organization.
      // MachineProvider and WorkspaceHost remount on this scope, disposing old transports.
      setState((current) =>
        current.me
          ? {
              ...current,
              me: {
                ...current.me,
                session: { ...current.me.session, activeOrganizationId: organizationId },
              },
              error: null,
            }
          : current,
      );
    } finally {
      changingSession.current = false;
    }
  };
  return (
    <AuthContext
      value={{
        ...state,
        initializing,
        profile: profile.profile,
        openProfile: profile.openProfile,
        direct,
        connectDirect: () => {
          if (!config.developmentDaemon) throw new Error("No private daemon is configured.");
          query.clear();
          setState({ me: null, loading: false, error: null });
          setDirect(true);
        },
        signIn,
        githubSignIn: githubProviders.available,
        githubSignInChecking: githubProviders.checking,
        githubSignInError: githubProviders.error,
        retryGitHubSignIn: githubProviders.retry,
        signInWithGitHub,
        signOut,
        refresh: async () => {
          await Promise.all([refresh(), githubProviders.retry()]);
        },
        switchOrganization,
      }}
    >
      {children}
      {profile.sheet}
    </AuthContext>
  );
}
