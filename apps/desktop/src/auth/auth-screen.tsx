import { StartupScreen } from "@/startup/startup-screen";
import { BrandMark } from "@/components/brand-mark";
import type { NativeSignInChoice } from "@concors/api-client";
import { Mail, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { describeAuthError, type AuthState } from "./auth-state.ts";
import { GitHubIcon, GoogleIcon } from "./provider-icons.tsx";
import { SignInError } from "./sign-in.ts";

interface AuthScreenProps {
  /** Anything but `signed-in`; the app itself renders once the session is valid. */
  readonly state: Exclude<AuthState, { status: "signed-in" }>;
  readonly onSignIn: (choice: NativeSignInChoice, signal: AbortSignal) => Promise<void>;
  /** Why sign-in cannot be offered here, shown in place of the buttons. */
  readonly signInUnavailable: string | null;
  readonly onRetry: () => void;
  /** Set for a guest, who chose to come here and can go back to what they were doing. */
  readonly onBack?: () => void;
}

const WAITING: Record<NativeSignInChoice["method"], string> = {
  github: "Continue with GitHub in your browser.",
  google: "Continue with Google in your browser.",
  email: "Enter the code we emailed you in your browser.",
};

/** Loose on purpose: the API validates properly, this only catches a half-typed address. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Where someone signs in, when they choose to or when a saved session cannot be checked. They
 * choose how to continue: GitHub, Google or an emailed code. There is no separate sign-up; a
 * returning person reaches their account and anyone new gets one. The system browser opens straight
 * on that method, on the API's own page. While a saved session is being checked it shows a quiet
 * splash instead.
 */
export function AuthScreen({
  state,
  onSignIn,
  signInUnavailable,
  onRetry,
  onBack,
}: AuthScreenProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<NativeSignInChoice["method"] | null>(null);
  const attempt = useRef<AbortController | null>(null);

  // Leaving this screen (for example, signing in succeeded) must release the loopback port.
  useEffect(() => () => attempt.current?.abort(), []);

  if (state.status === "restoring") return <StartupScreen />;

  const signIn = (choice: NativeSignInChoice) => {
    const controller = new AbortController();
    attempt.current = controller;
    setWaiting(choice.method);
    setError(null);
    onSignIn(choice, controller.signal)
      .catch((cause: unknown) => {
        // Cancelling is a choice, not a failure worth an error message.
        if (controller.signal.aborted || (cause instanceof SignInError && cause.cancelled)) return;
        setError(describeAuthError(cause));
      })
      .finally(() => {
        if (attempt.current === controller) attempt.current = null;
        setWaiting(null);
      });
  };

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!EMAIL_PATTERN.test(address)) {
      setError("Enter a valid email address.");
      return;
    }
    signIn({ method: "email", email: address });
  };

  return (
    // Sits on the window itself, like the sidebar: frosted where macOS blurs what is behind it. The
    // equal padding keeps it truly centred and clear of the title bar when it has to scroll.
    <main className="app-frame flex h-dvh scroll-py-13 items-start justify-center overflow-y-auto bg-sidebar px-6 py-13">
      <div className="my-auto w-full max-w-sm text-center">
        <BrandMark className="mx-auto mb-5 block size-15 text-primary" />

        <h1 className="text-xl font-semibold tracking-tight">Sign in to Concors</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">New here? This creates your account.</p>

        {state.status === "unavailable" && (
          <div
            role="alert"
            className="mt-5 flex items-start justify-between gap-3 rounded-lg border bg-muted/50 p-3 text-left text-xs"
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
            className="mt-6 flex items-center justify-between gap-3 rounded-lg border bg-muted/50 p-3 text-left text-sm"
          >
            <span>{WAITING[waiting]}</span>
            <Button variant="outline" onClick={() => attempt.current?.abort()}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="mt-6 grid gap-2.5">
            <Button
              variant="outline"
              className="min-h-9 w-full"
              onClick={() => signIn({ method: "github" })}
            >
              <GitHubIcon className="size-4" />
              Continue with GitHub
            </Button>
            <Button
              variant="outline"
              className="min-h-9 w-full"
              onClick={() => signIn({ method: "google" })}
            >
              <GoogleIcon className="size-4" />
              Continue with Google
            </Button>

            <div className="my-1.5 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>

            <form className="grid gap-2.5" onSubmit={submitEmail} noValidate>
              <Input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                aria-label="Email address"
                className="h-9"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <Button type="submit" className="min-h-9 w-full">
                <Mail aria-hidden="true" />
                Continue with email
              </Button>
            </form>
          </div>
        )}

        {error && (
          <div role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {onBack && (
          <>
            <p className="mt-4 rounded-lg border bg-muted/50 p-3 text-xs">
              Signing in restarts any terminals and agents running on this computer. If this account
              hasn&rsquo;t been used here before, your workspaces move to it.
            </p>
            <Button variant="ghost" className="mt-2 min-h-9 w-full" onClick={onBack}>
              Not now
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
