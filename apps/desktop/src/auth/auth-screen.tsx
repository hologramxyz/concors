import { BrandMark } from "@/components/brand-mark";
import type { SignInInput, SignUpInput } from "@concors/api-client";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { describeAuthError, type AuthState } from "./auth-state.ts";
import type { SignUpResult } from "./use-auth.ts";

export type AuthMode = "sign-in" | "sign-up";

interface AuthScreenProps {
  /** Anything but `signed-in`; the app itself renders once the session is valid. */
  readonly state: Exclude<AuthState, { status: "signed-in" }>;
  readonly onSignIn: (input: SignInInput) => Promise<void>;
  readonly onSignUp: (input: SignUpInput) => Promise<SignUpResult>;
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
export function AuthScreen({ state, onSignIn, onSignUp, onRetry }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const copy = COPY[mode];

  if (state.status === "restoring") {
    return (
      <main className="flex h-dvh items-center justify-center bg-background">
        <p role="status" className="text-sm text-muted-foreground" aria-live="polite">
          Restoring your session…
        </p>
      </main>
    );
  }

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
    <main className="flex h-dvh items-start justify-center overflow-y-auto bg-background p-6">
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
            <Button variant="outline" size="xs" onClick={onRetry} className="shrink-0">
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              Retry
            </Button>
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
                disabled={pending}
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
              disabled={pending}
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
              disabled={pending}
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

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? copy.busy : copy.submit}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          {mode === "sign-in" ? "New to Concors? " : "Already have an account? "}
          <button
            type="button"
            className="text-foreground underline underline-offset-3 hover:text-primary disabled:opacity-50"
            disabled={pending}
            onClick={() => switchMode(mode === "sign-in" ? "sign-up" : "sign-in")}
          >
            {mode === "sign-in" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
    </main>
  );
}
