import { StartupScreen } from "@/startup/startup-screen";
import { BrandMark } from "@/components/brand-mark";
import type { SignInInput, SignUpInput } from "@concors/api-client";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GitHubIcon } from "@/github/icon";

import { describeAuthError, type AuthState } from "./auth-state.ts";
import type { SignUpResult } from "./use-auth.ts";

export type AuthMode = "sign-in" | "sign-up";

interface AuthScreenProps {
  /** Anything but `signed-in`; the app itself renders once the session is valid. */
  readonly state: Exclude<AuthState, { status: "signed-in" }>;
  readonly onSignIn: (input: SignInInput) => Promise<void>;
  readonly onSignUp: (input: SignUpInput) => Promise<SignUpResult>;
  /** Present only when this build and the API both support GitHub sign-in. */
  readonly onSignInWithGitHub?: ((signal: AbortSignal) => Promise<void>) | undefined;
  readonly onRetry: () => void;
}

const COPY: Record<AuthMode, { title: string; description: string; submit: string; busy: string }> =
  {
    "sign-in": {
      title: "Sign in to Concors",
      description: "Your projects, machines and agents are waiting behind this door.",
      submit: "Sign in",
      busy: "Signing in…",
    },
    "sign-up": {
      title: "Create your Concors account",
      description: "Free while Concors is in preview. It takes ten seconds.",
      submit: "Create account",
      busy: "Creating account…",
    },
  };

/**
 * The only thing a signed-out user sees. Email + password sign-in and sign-up on one screen with
 * a mode toggle; while a saved session is being checked it shows a quiet splash instead.
 */
export function AuthScreen({
  state,
  onSignIn,
  onSignUp,
  onSignInWithGitHub,
  onRetry,
}: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [waitingForGitHub, setWaitingForGitHub] = useState(false);
  const github = useRef<AbortController | null>(null);
  const copy = COPY[mode];
  const busy = pending || waitingForGitHub;

  // Leaving this screen (for example, signing in succeeded) must release the loopback port.
  useEffect(() => () => github.current?.abort(), []);

  if (state.status === "restoring") return <StartupScreen />;

  const continueWithGitHub = () => {
    if (!onSignInWithGitHub) return;
    const controller = new AbortController();
    github.current = controller;
    setWaitingForGitHub(true);
    setError(null);
    setNotice(null);
    onSignInWithGitHub(controller.signal)
      .catch((cause: unknown) => {
        // Cancelling is a choice, not a failure worth an error message.
        if (!controller.signal.aborted) setError(describeAuthError(cause));
      })
      .finally(() => {
        if (github.current === controller) github.current = null;
        setWaitingForGitHub(false);
      });
  };

  const switchMode = (next: AuthMode) => {
    setError(null);
    setNotice(null);
    setMode(next);
  };

  const submit = async (form: HTMLFormElement) => {
    const values = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    const email = (values["email"] ?? "").trim();
    const password = values["password"] ?? "";
    if (mode === "sign-in") {
      await onSignIn({ email, password });
      return;
    }
    const result = await onSignUp({ name: (values["name"] ?? "").trim(), email, password });
    if (result === "verify-email") {
      setNotice("Account created. Check your inbox to verify your email, then sign in.");
      setMode("sign-in");
    }
  };

  return (
    <main className="flex h-dvh scroll-py-6 items-start justify-center overflow-y-auto bg-background p-6">
      <div className="my-auto w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <BrandMark className="size-8 text-primary" />
          <span className="text-[23px] font-semibold tracking-[-.06em]">concors</span>
        </div>

        <h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{copy.description}</p>

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

        {onSignInWithGitHub &&
          (waitingForGitHub ? (
            <div
              role="status"
              className="mt-6 flex items-center justify-between gap-3 rounded-lg border bg-muted/50 p-3 text-sm"
            >
              <span>Finish signing in with GitHub in your browser.</span>
              <Button variant="outline" onClick={() => github.current?.abort()}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              className="mt-6 w-full"
              disabled={busy}
              onClick={continueWithGitHub}
            >
              <GitHubIcon className="size-4" aria-hidden="true" />
              Continue with GitHub
            </Button>
          ))}
        {onSignInWithGitHub && (
          <div className="mt-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
        )}

        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            setNotice(null);
            void submit(event.currentTarget)
              .catch((cause: unknown) => setError(describeAuthError(cause)))
              .finally(() => setPending(false));
          }}
        >
          {mode === "sign-up" && (
            <div className="space-y-2 text-sm">
              <label htmlFor="auth-name">Name</label>
              <Input
                id="auth-name"
                name="name"
                autoComplete="name"
                placeholder="Ada Lovelace"
                required
                maxLength={120}
                disabled={busy}
                autoFocus
              />
            </div>
          )}
          <div className="space-y-2 text-sm">
            <label htmlFor="auth-email">Email</label>
            <Input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              maxLength={254}
              disabled={busy}
              autoFocus={mode === "sign-in"}
            />
          </div>
          <div className="space-y-2 text-sm">
            <label htmlFor="auth-password">Password</label>
            <Input
              id="auth-password"
              name="password"
              type="password"
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              placeholder={mode === "sign-up" ? "At least 8 characters" : "••••••••"}
              required
              minLength={8}
              maxLength={128}
              disabled={busy}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={busy}>
            {pending ? copy.busy : copy.submit}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          {mode === "sign-in" ? "New to Concors? " : "Already have an account? "}
          <button
            type="button"
            className="text-foreground underline underline-offset-3 hover:text-primary disabled:opacity-50"
            disabled={busy}
            onClick={() => switchMode(mode === "sign-in" ? "sign-up" : "sign-in")}
          >
            {mode === "sign-in" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
    </main>
  );
}
