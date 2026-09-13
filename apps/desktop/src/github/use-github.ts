import { useCallback, useEffect, useRef, useState } from "react";
import type { GitHubStatus } from "@concors/api-client";
import { api } from "@/auth/api";
import { openExternal } from "@/tauri";

export function useGitHub() {
  const awaitingReturn = useRef(false);
  const [previousConnection, setPreviousConnection] = useState<string | null>(null);
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [accountResult, setAccountResult] = useState<{
    connection: string | null;
    accounts: { id: number; login: string }[];
  } | null>(null);
  const accounts =
    status?.connected && accountResult?.connection === status.updatedAt
      ? accountResult.accounts
      : null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((n) => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    void api
      .githubStatus()
      .then(async (value) => {
        if (!cancelled) {
          setStatus(value);
          if (!value.connected) {
            setAccountResult(null);
          } else {
            let next: number | null = 1;
            const accounts: { id: number; login: string }[] = [];
            while (next !== null && !cancelled) {
              const data = await api.githubAccounts(next);
              accounts.push(...data.accounts);
              next = data.nextPage;
            }
            if (!cancelled) setAccountResult({ connection: value.updatedAt, accounts });
          }
          if (!cancelled) setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Could not load GitHub connection");
      });
    return () => {
      cancelled = true;
    };
  }, [generation]);
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
      refresh();
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [refresh]);
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
      setAccountResult(null);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect GitHub");
    } finally {
      setBusy(false);
    }
  };
  return {
    status,
    accounts,
    error,
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
