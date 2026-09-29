import { StartupScreen } from "@/startup/startup-screen";
import { BrandMark } from "@/components/brand-mark";
import type { NativeSignInChoice } from "@concors/api-client";
import { ACCOUNT_NOT_FOUND } from "@concors/client-core";
import { Mail, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { describeAuthError, type AuthState } from "./auth-state.ts";
import { GitHubIcon, GoogleIcon } from "./provider-icons.tsx";
import { SignInError } from "./sign-in.ts";

type Intent = NativeSignInChoice["intent"];

interface AuthScreenProps {
  /** Anything but `signed-in`; the app itself renders once the session is valid. */
  readonly state: Exclude<AuthState, { status: "signed-in" }>;
  readonly onSignIn: (choice: NativeSignInChoice, signal: AbortSignal) => Promise<void>;
  /** Why sign-in cannot be offered here, shown in place of the buttons. */
  readonly signInUnavailable: string | null;
  readonly onRetry: () => void;
}

const WAITING: Record<NativeSignInChoice["method"], string> = {
  github: "Continue with GitHub in your browser.",
  google: "Continue with Google in your browser.",
  email: "Enter the code we emailed you in your browser.",
};

/** Loose on purpose: the API validates properly, this only catches a half-typed address. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The only thing a signed-out user sees. They choose to sign in or sign up, then how: GitHub,
 * Google or an emailed code. The system browser opens straight on that method, on the API's own
 * page. While a saved session is being checked it shows a quiet splash instead.
 */
export function AuthScreen({ state, onSignIn, signInUnavailable, onRetry }: AuthScreenProps) {
  const [intent, setIntent] = useState<Intent>("sign-in");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<{ message: string; noAccount: boolean } | null>(null);
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
        setError({
          message: describeAuthError(cause),
          noAccount: cause instanceof SignInError && cause.code === ACCOUNT_NOT_FOUND,
        });
      })
      .finally(() => {
        if (attempt.current === controller) attempt.current = null;
        setWaiting(null);
      });
  };

  const switchTo = (next: Intent) => {
    setIntent(next);
    setError(null);
  };

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!EMAIL_PATTERN.test(address)) {
      setError({ message: "Enter a valid email address.", noAccount: false });
      return;
    }
    signIn({ method: "email", email: address, intent });
  };

  const signingUp = intent === "sign-up";

  return (
    <main className="flex h-dvh scroll-py-6 items-start justify-center overflow-y-auto bg-background p-6">
      <div className="my-auto w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <BrandMark className="size-8 text-primary" />
          <span className="text-[23px] font-semibold tracking-[-.06em]">concors</span>
        </div>

        <div
          role="tablist"
          aria-label="Sign in or sign up"
          className="mb-6 grid grid-cols-2 rounded-lg border bg-muted/40 p-0.5"
        >
          {(["sign-in", "sign-up"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={intent === option}
              disabled={waiting !== null}
              onClick={() => switchTo(option)}
              className={cn(
                "flex h-7 items-center justify-center rounded-md text-ui font-medium disabled:opacity-60",
                intent === option
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option === "sign-in" ? "Sign in" : "Sign up"}
            </button>
          ))}
        </div>

        <h1 className="text-xl font-semibold tracking-tight">
          {signingUp ? "Create your Concors account" : "Sign in to Concors"}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {signingUp
            ? "Choose how you want to sign up. You'll finish in your browser."
            : "Use the method you signed up with. You'll finish in your browser."}
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
              onClick={() => signIn({ method: "github", intent })}
            >
              <GitHubIcon className="size-4" />
              Continue with GitHub
            </Button>
            <Button
              variant="outline"
              className="min-h-9 w-full"
              onClick={() => signIn({ method: "google", intent })}
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
            {error.message}
            {error.noAccount && (
              <Button
                variant="link"
                className="ml-1 h-auto min-h-0 p-0 align-baseline"
                onClick={() => switchTo("sign-up")}
              >
                Sign up instead
              </Button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
