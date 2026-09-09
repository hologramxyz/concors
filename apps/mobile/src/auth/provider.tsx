import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, type Me } from "@concors/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { AppState } from "react-native";
import { api } from "./runtime";
import { tokenStore } from "../platform/storage";
import { disablePush } from "../platform/notifications";

interface AuthState {
  me: Me | null;
  loading: boolean;
  error: string | null;
}
interface AuthContextValue extends AuthState {
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("Missing AuthProvider");
  return value;
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const query = useQueryClient();
  const generation = useRef(0);
  const changingSession = useRef(false);
  const [state, setState] = useState<AuthState>({ me: null, loading: true, error: null });
  const refresh = async () => {
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
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
  const signOut = async () => {
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
      await tokenStore.flush();
    } catch {
      error = "Could not remove the saved session. Retry sign-out before closing the app.";
    }
    setState({ me: null, loading: false, error });
    changingSession.current = false;
  };
  return <AuthContext value={{ ...state, signIn, signOut, refresh }}>{children}</AuthContext>;
}
