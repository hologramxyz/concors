import { useCallback, useEffect, useRef, useState } from "react";
import type { GitHubStatus } from "@concors/api-client";
import { api } from "@/auth/api";
import { openExternal } from "@/tauri";

export function useGitHub() {
  const previousConnection = useRef<string | null>(null);
  const [status, setStatus] = useState<GitHubStatus | null>(null);
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
      .then((value) => {
        if (!cancelled) {
          setStatus(value);
          if (value.connected && value.updatedAt !== previousConnection.current) setWaiting(false);
          setError(null);
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
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [refresh]);
  const connect = async () => {
    setBusy(true);
    setError(null);
    previousConnection.current = status?.updatedAt ?? null;
    try {
      const { url } = await api.connectGitHub();
      setAuthorizeUrl(url);
      await openExternal(url);
      setWaiting(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect GitHub");
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.disconnectGitHub();
      setWaiting(false);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect GitHub");
    } finally {
      setBusy(false);
    }
  };
  return { status, error, busy, waiting, authorizeUrl, generation, refresh, connect, disconnect };
}
