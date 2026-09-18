/**
 * Opens Stripe's Customer Portal — the only place a card can be replaced, since Concors never sees
 * card numbers. The portal is a page in the system browser, so there is no callback to wait on:
 * coming back to the window is the signal that something may have changed, and the caller refreshes
 * then. Shared by the billing settings and the payment-failure warning, which must agree on what
 * "update your card" does.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/auth/api";
import { describeMachinesError } from "@/machines/use-machines";
import { openExternal } from "@/tauri";

export interface BillingPortal {
  readonly open: () => void;
  readonly opening: boolean;
  readonly error: string | null;
}

export function useBillingPortal(
  organizationId: string | undefined,
  onReturn: () => void,
): BillingPortal {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only a return from a portal we opened refreshes; every other window focus is ignored.
  const awaiting = useRef(false);
  const callback = useRef(onReturn);
  useEffect(() => {
    callback.current = onReturn;
  });

  useEffect(() => {
    const returned = () => {
      if (!awaiting.current) return;
      awaiting.current = false;
      callback.current();
    };
    window.addEventListener("focus", returned);
    return () => window.removeEventListener("focus", returned);
  }, []);

  const open = useCallback(() => {
    if (organizationId === undefined) return;
    setOpening(true);
    setError(null);
    void api
      .createBillingPortalUrl({ organizationId })
      .then((url) => {
        awaiting.current = true;
        return openExternal(url);
      })
      .catch((cause: unknown) => {
        awaiting.current = false;
        setError(describeMachinesError(cause));
      })
      .finally(() => setOpening(false));
  }, [organizationId]);

  return { open, opening, error };
}
