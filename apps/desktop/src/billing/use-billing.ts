import type { BillingStatus, SetupCheckout } from "@concors/api-client";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/auth/api";
import { describeMachinesError } from "@/machines/use-machines";
import { openExternal } from "@/tauri";

/** Scoped by the parent's organization key; confirms only the checkout we opened. */
export function useBilling(organizationId: string) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [checkout, setCheckout] = useState<SetupCheckout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    void api
      .getBillingStatus({ organizationId })
      .then((value) => {
        if (!cancelled) {
          setStatus(value);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeMachinesError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, generation]);

  useEffect(() => {
    if (!checkout) return;
    const sessionId = checkout.sessionId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      try {
        const result = await api.confirmBillingSetup(sessionId, { organizationId });
        if (cancelled) return;
        if (result.status === "complete") {
          setCheckout(null);
          refresh();
          return;
        }
        if (result.status === "expired") {
          setCheckout(null);
          setError("The Stripe page expired. Add your card again to continue.");
          return;
        }
        setError(null);
      } catch (cause: unknown) {
        if (cancelled) return;
        setError(describeMachinesError(cause));
      }
      if (!cancelled) timer = setTimeout(() => void check(), 3_000);
    }
    void check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [checkout, organizationId, refresh]);

  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  async function addCard() {
    setOpening(true);
    setError(null);
    try {
      const created = await api.createBillingSetup({ organizationId });
      setCheckout(created);
      await openExternal(created.url);
    } catch (cause: unknown) {
      setError(describeMachinesError(cause));
    } finally {
      setOpening(false);
    }
  }

  return {
    status,
    checkout,
    error,
    opening,
    addCard,
    refresh,
    stopWaiting: () => setCheckout(null),
  };
}
