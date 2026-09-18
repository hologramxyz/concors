import type { SetupCheckout } from "@concors/api-client";
import { useCallback, useEffect, useState } from "react";

import { useApiResource } from "@/data/api-resource";
import { api } from "@/auth/api";
import { describeMachinesError } from "@/machines/use-machines";
import { openExternal } from "@/tauri";

/**
 * Billing status on its own, for callers that only need to read it — the machines list wants
 * `paymentFailedAt` without dragging in the card-setup machinery below. One definition of the
 * cache key keeps those callers sharing a single request with the settings page.
 */
export function useBillingStatus(organizationId: string) {
  return useApiResource(`billing:${organizationId}`, () =>
    api.getBillingStatus({ organizationId }),
  );
}

/** Scoped by the parent's organization key; confirms only the checkout we opened. */
export function useBilling(organizationId: string) {
  const query = useBillingStatus(organizationId);
  const status = query.data;
  const [checkout, setCheckout] = useState<SetupCheckout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const refresh = useCallback(() => {
    setError(null);
    void query.resource.load(30_000, true);
  }, [query.resource]);

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
          query.resource.invalidate();
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
  }, [checkout, organizationId, refresh, query.resource]);

  useEffect(() => {
    const check = () => {
      void query.resource.load(30_000);
    };
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [query.resource]);

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
    error: error ?? (query.error ? describeMachinesError(query.error) : null),
    opening,
    addCard,
    refresh,
    stopWaiting: () => setCheckout(null),
  };
}
