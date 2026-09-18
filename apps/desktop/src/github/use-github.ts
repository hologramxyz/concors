import { githubStatusResource } from "./use-github-status";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiCache, useApiResource } from "@/data/api-resource";
import { api } from "@/auth/api";
import { openExternal } from "@/tauri";

export function useGitHub() {
  const awaitingReturn = useRef(false);
  const [previousConnection, setPreviousConnection] = useState<string | null>(null);
  const query = useApiResource("github:connection", async () => {
    const identity = githubStatusResource();
    await identity.load();
    const snapshot = identity.getSnapshot();
    if (snapshot.error) throw snapshot.error;
    const status = snapshot.data;
    if (!status) throw new Error("Could not load GitHub connection");
    const accounts: { id: number; login: string }[] = [];
    if (status.connected) {
      let next: number | null = 1;
      while (next !== null) {
        const data = await api.githubAccounts(next);
        accounts.push(...data.accounts);
        next = data.nextPage;
      }
    }
    return { status, accounts };
  });
  const status = query.data?.status ?? null;
  const accounts = query.data?.accounts ?? null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => {
    setError(null);
    apiCache().invalidate("github:repos:");
    setGeneration((n) => n + 1);
    void githubStatusResource()
      .load(30_000, true)
      .then(() => query.resource.load(30_000, true));
  }, [query.resource]);
  useEffect(() => {
    if (!waiting) return;
    const interval = window.setInterval(refresh, 3000);
    const timeout = window.setTimeout(() => setWaiting(false), 120000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [waiting, refresh]);
  useEffect(() => {
    // Ordinary tab/window switching must not invalidate the repository picker.
    // Only a return from the external GitHub flow can have changed installation access.
    const focus = () => {
      if (!awaitingReturn.current) return;
      awaitingReturn.current = false;
      setWaiting(false);
      query.resource.invalidate();
      refresh();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("concors-foreground", focus);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("concors-foreground", focus);
    };
  }, [refresh, query.resource]);
  const connect = async () => {
    setPreviousConnection(status?.updatedAt ?? null);
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.connectGitHub();
      setAuthorizeUrl(url);
      awaitingReturn.current = true;
      setWaiting(true);
      await openExternal(url);
    } catch (cause) {
      awaitingReturn.current = false;
      setWaiting(false);
      setError(cause instanceof Error ? cause.message : "Could not connect GitHub");
    } finally {
      setBusy(false);
    }
  };
  const manage = async () => {
    if (!status?.manageUrl) return;
    setError(null);
    setAuthorizeUrl(status.manageUrl);
    awaitingReturn.current = true;
    setWaiting(true);
    try {
      await openExternal(status.manageUrl);
    } catch (cause) {
      awaitingReturn.current = false;
      setWaiting(false);
      setError(cause instanceof Error ? cause.message : "Could not open GitHub repository access");
    }
  };
  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.disconnectGitHub();
      awaitingReturn.current = false;
      setWaiting(false);
      const disconnected = {
        connected: false,
        configured: status?.configured ?? true,
        identityConnected: status?.identityConnected ?? false,
        login: null,
        updatedAt: null,
        manageUrl: null,
      };
      githubStatusResource().set(disconnected);
      query.resource.set({ status: disconnected, accounts: [] });
      apiCache().invalidate("github:repos:", true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect GitHub");
    } finally {
      setBusy(false);
    }
  };
  return {
    status,
    accounts,
    error:
      error ??
      (query.error instanceof Error
        ? query.error.message
        : query.error
          ? "Could not load GitHub connection"
          : null),
    busy,
    waiting,
    authorizeUrl:
      status?.connected && status.updatedAt !== previousConnection
        ? status.manageUrl
        : authorizeUrl,
    generation,
    refresh,
    connect,
    manage,
    disconnect,
  };
}
