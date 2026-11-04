import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, LoaderCircle } from "lucide-react";
import type { DaemonConnection } from "@concors/daemon-client";
import type { AgentAccount, AgentAccountAction, ProviderStatus } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { copyText } from "@/lib/clipboard";
import { openExternal } from "@/tauri/open-external";
import { accountName, UNNAMED_SUBSCRIPTION } from "./account-name";
import { accountChanges, requestAccount } from "./account-requests";
import { accountPromptKey, setAccountPromptDismissed } from "./dismissed-account-prompts";
import { invalidateModelCatalogs } from "./model-catalog";

/**
 * Signing in to a provider without going through an open chat. Settings → Subscriptions and the
 * model menu both open this dialog, so there is one sign-in flow, whichever way someone comes.
 */
export function AccountConnectDialog({
  connection,
  provider,
  startRightAway = false,
  onChanged,
  onClose,
}: {
  connection: DaemonConnection;
  provider: Pick<ProviderStatus, "id" | "label" | "subscription"> & { engine?: string | undefined };
  /** For a control that already said "connect": skips the button when there is only one way in. */
  startRightAway?: boolean;
  onChanged?: () => void;
  onClose: () => void;
}) {
  const [account, setAccount] = useState<AgentAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState("");
  const [value, setValue] = useState("");
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);
  const latest = useRef<AgentAccount | null>(null);
  const reading = useRef(false);
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);
  const request = useCallback(
    async (action: AgentAccountAction, background = false) => {
      if (action.type === "read") {
        if (reading.current) return;
        reading.current = true;
      }
      if (!background) setBusy(true);
      setError(null);
      try {
        const next = await requestAccount(connection, provider.id, action);
        if (!mounted.current) {
          if (next.challenge)
            void requestAccount(connection, provider.id, {
              type: "cancel",
              flowId: next.challenge.flowId,
            }).catch(() => undefined);
          return;
        }
        if (
          action.type === "read" &&
          latest.current?.status === "pending" &&
          next.status === "disconnected" &&
          !next.message
        )
          next.message = "Sign-in expired or was cancelled. Try again.";
        if (next.status === "connected" && latest.current?.status !== "connected") {
          setAccountPromptDismissed(
            accountPromptKey(
              connection.workspace?.machineId ?? connection.endpoint.url,
              provider.id,
            ),
            false,
          );
          invalidateModelCatalogs(connection);
          accountChanges.dispatchEvent(new Event("change"));
          changed.current?.();
        }
        latest.current = next;
        setAccount(next);
        if (action.type === "complete" || next.status === "connected") setValue("");
      } catch (cause) {
        if (mounted.current)
          setError(cause instanceof Error ? cause.message : "Could not connect the account");
      } finally {
        if (action.type === "read") reading.current = false;
        if (mounted.current && !background) setBusy(false);
      }
    },
    [connection, provider.id],
  );
  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(() => {
      if (mounted.current) void request({ type: "read" });
    });
    return () => {
      mounted.current = false;
      // Closing the dialog abandons an unfinished sign-in; it never signs an account out.
      const challenge = latest.current?.challenge;
      if (challenge)
        void requestAccount(connection, provider.id, {
          type: "cancel",
          flowId: challenge.flowId,
        }).catch(() => undefined);
    };
  }, [connection, provider.id, request]);
  useEffect(() => {
    if (account?.status !== "pending") return;
    const timer = setInterval(() => void request({ type: "read" }, true), 2000);
    return () => clearInterval(timer);
  }, [account?.status, request]);
  const started = useRef(false);
  useEffect(() => {
    if (!startRightAway || started.current || account?.status !== "disconnected") return;
    const only = account.methods?.length === 1 ? account.methods[0] : undefined;
    if (!only || account.challenge) return;
    started.current = true;
    void Promise.resolve().then(() => {
      if (mounted.current) void request({ type: "start", methodId: only.id });
    });
  }, [startRightAway, account, request]);
  const methods = account?.methods ?? [];
  const selected = methods.find((m) => m.id === method) ?? methods[0];
  const challenge = account?.challenge;
  const signsInto = accountName(provider.engine, provider.label);
  // Several subscriptions can share an account name, so a named one is told apart by its label.
  const nickname = provider.subscription?.nickname;
  const title =
    nickname && nickname !== UNNAMED_SUBSCRIPTION
      ? `Sign in to ${provider.label}`
      : `Sign in to ${signsInto === "model provider" ? "your model provider" : signsInto}`;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Signs this provider in on this machine.
          </DialogDescription>
        </DialogHeader>
        {(error || account?.message) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? account?.message}
          </p>
        )}
        {!account && !error && (
          <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" /> Checking sign-in…
          </p>
        )}
        {account?.status === "connected" && (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-1.5">
              <Check className="size-4 text-green-600" />
              Connected{account.label ? ` as ${account.label}` : ""}.
            </p>
            <div className="flex justify-end gap-2">
              {selected && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setCopied(false);
                    void request({ type: "start", methodId: selected.id });
                  }}
                >
                  Sign in again
                </Button>
              )}
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
        {challenge && (
          <div className="space-y-2">
            {challenge.instructions && (
              <p className="text-xs text-muted-foreground">{challenge.instructions}</p>
            )}
            {challenge.code && (
              <div className="flex items-center gap-2">
                <code className="rounded border bg-background px-3 py-2 text-base tracking-wider">
                  {challenge.code}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy sign-in code"
                  onClick={() => {
                    if (challenge.code)
                      void copyText(challenge.code).then(
                        () => {
                          setCopied(true);
                          setError(null);
                        },
                        () => {
                          setCopied(false);
                          setError("Could not copy. Select the code and copy it manually.");
                        },
                      );
                  }}
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </Button>
              </div>
            )}
            {challenge.url && (
              <Button
                variant="outline"
                onClick={() => {
                  // The sign-in page asks for the code, so have it on the clipboard there.
                  if (challenge.code)
                    void copyText(challenge.code).then(
                      () => setCopied(true),
                      () => undefined,
                    );
                  if (challenge.url)
                    void openExternal(challenge.url).catch(() =>
                      setError("Could not open sign-in. Try again."),
                    );
                }}
              >
                Open sign-in page
                <ExternalLink className="size-3" />
              </Button>
            )}
            {challenge.input && (
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (value.trim())
                    void request({
                      type: "complete",
                      flowId: challenge.flowId,
                      value: value.trim(),
                    });
                }}
              >
                <input
                  className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={
                    challenge.input === "api-key" ? "Provider API key" : "Authorization code"
                  }
                  placeholder={
                    challenge.input === "api-key"
                      ? "Paste your API key"
                      : "Paste authorization code"
                  }
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  disabled={busy}
                  maxLength={8192}
                />
                <Button variant="outline" type="submit" disabled={busy || !value.trim()}>
                  Connect
                </Button>
              </form>
            )}
            <div className="flex items-center justify-between gap-2">
              <span
                role="status"
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <LoaderCircle className="size-3 animate-spin" />
                Waiting for sign-in…
              </span>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setValue("");
                  void request({ type: "cancel", flowId: challenge.flowId });
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {account && account.status !== "connected" && !challenge && (
          <div className="flex flex-wrap items-center gap-2">
            {methods.length > 1 && (
              <select
                aria-label="Account sign-in method"
                className="max-w-full min-w-0 rounded-md border bg-background px-2 py-1.5 text-xs"
                value={selected?.id ?? ""}
                onChange={(e) => setMethod(e.target.value)}
                disabled={busy}
              >
                {methods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
            {selected ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setCopied(false);
                  void request({ type: "start", methodId: selected.id });
                }}
              >
                {busy
                  ? "Connecting…"
                  : selected.kind === "api-key"
                    ? "Add API key"
                    : methods.length === 1
                      ? selected.label
                      : "Connect account"}
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void request({ type: "read" })}
              >
                {busy ? "Checking account…" : "Check account"}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
