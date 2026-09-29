import { StartupScreen } from "@/startup/startup-screen";
import { BrandMark } from "@/components/brand-mark";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { describeAuthError, type AuthState } from "./auth-state.ts";

interface AuthScreenProps {
  /** Anything but `signed-in`; the app itself renders once the session is valid. */
  readonly state: Exclude<AuthState, { status: "signed-in" }>;
  readonly onSignIn: (signal: AbortSignal) => Promise<void>;
  /** Why sign-in cannot be offered here, shown in place of the button. */
  readonly signInUnavailable: string | null;
  readonly onRetry: () => void;
}

/**
 * The only thing a signed-out user sees: one button that continues in the system browser, where
 * the API's sign-in page offers GitHub, Google and an emailed code. While a saved session is being
 * checked it shows a quiet splash instead.
 */
export function AuthScreen({ state, onSignIn, signInUnavailable, onRetry }: AuthScreenProps) {
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const attempt = useRef<AbortController | null>(null);

  // Leaving this screen (for example, signing in succeeded) must release the loopback port.
  useEffect(() => () => attempt.current?.abort(), []);

  if (state.status === "restoring") return <StartupScreen />;

  const signIn = () => {
    const controller = new AbortController();
    attempt.current = controller;
    setWaiting(true);
    setError(null);
    onSignIn(controller.signal)
      .catch((cause: unknown) => {
        // Cancelling is a choice, not a failure worth an error message.
        if (!controller.signal.aborted) setError(describeAuthError(cause));
      })
      .finally(() => {
        if (attempt.current === controller) attempt.current = null;
        setWaiting(false);
      });
  };

  return (
    <main className="flex h-dvh scroll-py-6 items-start justify-center overflow-y-auto bg-background p-6">
      <div className="my-auto w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <BrandMark className="size-8 text-primary" />
          <span className="text-[23px] font-semibold tracking-[-.06em]">concors</span>
        </div>

        <h1 className="text-xl font-semibold tracking-tight">Sign in to Concors</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Continue in your browser with GitHub, Google or email.
        </p>

        {state.status === "unavailable" && (
          <div
            role="alert"
            className="mt-5 flex items-start justify-between gap-3 rounded-lg border bg-muted/50 p-3 text-xs"
          >
            <span>
              <span className="font-medium">Your saved session could not be checked.</span>
              <span className="mt-0.5 block text-muted-foreground">{state.message}</span>
            </span>
            <Button variant="outline" onClick={onRetry}>
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              Retry
            </Button>
          </div>
        )}

        {signInUnavailable !== null ? (
          <p role="status" className="mt-6 text-sm text-muted-foreground">
            {signInUnavailable}
          </p>
        ) : waiting ? (
          <div
            role="status"
            className="mt-6 flex items-center justify-between gap-3 rounded-lg border bg-muted/50 p-3 text-sm"
          >
            <span>Finish signing in in your browser.</span>
            <Button variant="outline" onClick={() => attempt.current?.abort()}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button className="mt-6 w-full" onClick={signIn}>
            Sign in
          </Button>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
