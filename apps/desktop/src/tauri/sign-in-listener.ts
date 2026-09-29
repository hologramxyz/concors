import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";

/*
 * Wrapper around `src-tauri/src/sign_in.rs`, the one-shot loopback receiver the control plane
 * redirects the browser to after signing in. It only delivers what arrived on the port; the PKCE
 * verifier and the exchange stay in `auth/sign-in.ts`.
 */

const AttemptSchema = z.object({ attempt: z.number().int(), port: z.number().int() });
const CallbackSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("code"), code: z.string() }),
  z.object({ kind: z.literal("error"), error: z.string() }),
]);
const EventSchema = z.object({ attempt: z.number().int(), result: CallbackSchema });

export type SignInCallback = z.infer<typeof CallbackSchema>;

export interface SignInListener {
  /** Loopback port the browser must be redirected to. */
  readonly port: number;
  /** Settles with what arrived, or `{ kind: "error", error: "cancelled" }` after `cancel()`. */
  readonly result: Promise<SignInCallback>;
  /** Stops listening. Safe to call more than once, and after `result` has settled. */
  cancel(): void;
}

export async function startSignInListener(): Promise<SignInListener> {
  let settle: (result: SignInCallback) => void = () => undefined;
  const result = new Promise<SignInCallback>((resolve) => {
    settle = resolve;
  });
  // A holder rather than a `let`: the event callback can run before the attempt number is known.
  const current: { attempt?: number } = {};
  const early: z.infer<typeof EventSchema>[] = [];
  let done = false;

  const finish = (outcome: SignInCallback) => {
    if (done) return;
    done = true;
    unlisten();
    settle(outcome);
  };
  // Subscribe before the receiver exists, so a callback can never arrive unheard.
  const unlisten = await listen("native-sign-in", (event) => {
    const parsed = EventSchema.safeParse(event.payload);
    if (!parsed.success) return;
    if (current.attempt === undefined) early.push(parsed.data);
    else if (parsed.data.attempt === current.attempt) finish(parsed.data.result);
  });

  let started: z.infer<typeof AttemptSchema>;
  try {
    started = AttemptSchema.parse(await invoke("start_sign_in_listener"));
  } catch (error) {
    unlisten();
    throw error;
  }
  current.attempt = started.attempt;
  const pending = early.find((event) => event.attempt === started.attempt);
  if (pending) finish(pending.result);

  return {
    port: started.port,
    result,
    cancel: () => {
      if (done) return;
      void invoke("cancel_sign_in_listener");
      finish({ kind: "error", error: "cancelled" });
    },
  };
}
