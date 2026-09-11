import { PaneVisibilityContext } from "@/components/compact-layout";
import { copyText } from "@/lib/clipboard";
import { useTabVisible } from "@/workspace/tab-visibility";
import type { DaemonConnection } from "@concors/daemon-client";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, LoaderCircle, X } from "lucide-react";
import {
  agentProviderNames,
  type AgentAccount,
  type AgentAccountAction,
  type AgentInfo,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { openExternal } from "@/tauri/open-external";

const button = "rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-40";
function dismissed(key: string) {
  try {
    return sessionStorage.getItem(key) === "dismissed";
  } catch {
    return false;
  }
}
export function AgentAccountPrompt({ agent, canEdit }: { agent: AgentInfo; canEdit: boolean }) {
  const connection = useContext(TerminalConnectionContext);
  const paneVisible = useContext(PaneVisibilityContext);
  const tabVisible = useTabVisible();
  if (
    !paneVisible ||
    !tabVisible ||
    !connection ||
    connection.state.status !== "ready" ||
    !connection.state.daemon.capabilities?.includes("agent-accounts") ||
    !["codex", "claude", "opencode"].includes(agent.engine ?? agent.provider)
  )
    return null;
  return (
    <AccountPrompt
      key={`${connection.endpoint.url}:${agent.id}`}
      agent={agent}
      canEdit={canEdit}
      connection={connection}
    />
  );
}
function AccountPrompt({
  agent,
  canEdit,
  connection,
}: {
  agent: AgentInfo;
  canEdit: boolean;
  connection: DaemonConnection;
}) {
  const storageKey = `concors:account-prompt:${connection.endpoint.url}:${agent.provider}`;
  const [hidden, setHidden] = useState(() => dismissed(storageKey));
  const [account, setAccount] = useState<AgentAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState("");
  const [value, setValue] = useState("");
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);
  const isDismissed = useRef(hidden);
  const pending = useRef(false);
  const latest = useRef<AgentAccount | null>(null);
  const request = useCallback(
    async (action: AgentAccountAction) => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true);
      setError(null);
      try {
        const result = await connection.requestAgent(
          { kind: "account", sessionId: agent.id, action },
          crypto.randomUUID(),
        );
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        const next = result.outcome.account;
        if (!next) throw new Error("This machine needs a daemon update to connect accounts here.");
        if (!mounted.current || isDismissed.current) {
          if (next.challenge)
            void connection
              .requestAgent(
                {
                  kind: "account",
                  sessionId: agent.id,
                  action: { type: "cancel", flowId: next.challenge.flowId },
                },
                crypto.randomUUID(),
              )
              .catch(() => undefined);
          return;
        }
        if (
          action.type === "read" &&
          latest.current?.status === "pending" &&
          next.status === "disconnected" &&
          !next.message
        )
          next.message = "Sign-in expired or was cancelled. Try again.";
        latest.current = next;
        setAccount(next);
        if (action.type === "complete" || next.status === "connected") setValue("");
      } catch (cause) {
        if (mounted.current && !isDismissed.current)
          setError(cause instanceof Error ? cause.message : "Could not connect account");
      } finally {
        pending.current = false;
        if (mounted.current) {
          setBusy(false);
          if (action.type === "complete") setValue("");
        }
      }
    },
    [connection, agent.id],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const challenge = latest.current?.challenge;
      if (challenge)
        void connection
          .requestAgent(
            {
              kind: "account",
              sessionId: agent.id,
              action: { type: "cancel", flowId: challenge.flowId },
            },
            crypto.randomUUID(),
          )
          .catch(() => undefined);
    };
  }, [connection, agent.id]);
  useEffect(() => {
    if (hidden || !canEdit) return;
    void Promise.resolve().then(() => {
      if (mounted.current && !isDismissed.current) void request({ type: "read" });
    });
    const check = () => {
      if (!latest.current?.challenge) void request({ type: "read" });
    };
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [hidden, canEdit, request]);
  useEffect(() => {
    if (hidden || account?.status !== "pending") return;
    const timer = setInterval(() => void request({ type: "read" }), 2000);
    return () => clearInterval(timer);
  }, [hidden, account?.status, request]);
  const hide = () => {
    // A dismissal cancels an unfinished sign-in; it never signs out an existing account.
    const challenge = latest.current?.challenge;
    if (challenge) void request({ type: "cancel", flowId: challenge.flowId });
    setValue("");
    isDismissed.current = true;
    setHidden(true);
    try {
      sessionStorage.setItem(storageKey, "dismissed");
    } catch {
      /* In-memory dismissal still works. */
    }
  };
  if (!canEdit) return null;
  if (hidden)
    return (
      <button
        className="text-xs text-muted-foreground hover:text-foreground"
        onClick={() => {
          isDismissed.current = false;
          setHidden(false);
          try {
            sessionStorage.removeItem(storageKey);
          } catch {
            /* Optional browser storage. */
          }
        }}
      >
        Connect account
      </button>
    );
  if (account?.status === "connected") return null;
  const methods = account?.methods ?? [];
  const selected = methods.find((m) => m.id === method) ?? methods[0];
  const challenge = account?.challenge;
  return (
    <section
      aria-label={`${agentProviderNames[agent.provider]} account connection`}
      className="rounded-xl border bg-muted/30 p-3 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            Connect your{" "}
            {agent.provider === "codex"
              ? "ChatGPT"
              : agent.provider === "claude"
                ? "Claude"
                : "model provider"}{" "}
            account
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Use your account on this machine. You can dismiss this and continue with your current
            setup.
          </p>
        </div>
        <button
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
          aria-label="Dismiss account connection"
          onClick={hide}
        >
          <X className="size-4" />
        </button>
      </div>
      {(error || account?.message) && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error ?? account?.message}
        </p>
      )}
      {challenge ? (
        <div className="mt-3 space-y-2">
          {challenge.instructions && (
            <p className="text-xs text-muted-foreground">{challenge.instructions}</p>
          )}
          {challenge.code && (
            <div className="flex items-center gap-2">
              <code className="rounded border bg-background px-3 py-2 text-base tracking-wider">
                {challenge.code}
              </code>
              <button
                className={button}
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
              </button>
            </div>
          )}
          {challenge.url && (
            <button
              className={`${button} inline-flex items-center gap-1.5`}
              onClick={() => {
                if (challenge.url)
                  void openExternal(challenge.url).catch(() =>
                    setError("Could not open sign-in. Try again."),
                  );
              }}
            >
              Open sign-in page
              <ExternalLink className="size-3" />
            </button>
          )}
          {challenge.input && (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (value.trim())
                  void request({ type: "complete", flowId: challenge.flowId, value: value.trim() });
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
                  challenge.input === "api-key" ? "Paste your API key" : "Paste authorization code"
                }
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={busy}
                maxLength={8192}
              />
              <button className={button} type="submit" disabled={busy || !value.trim()}>
                Connect
              </button>
            </form>
          )}
          <div className="flex items-center justify-between gap-2">
            <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LoaderCircle className="size-3 animate-spin" />
              Waiting for sign-in…
            </span>
            <button
              className={button}
              disabled={busy}
              onClick={() => {
                setValue("");
                void request({ type: "cancel", flowId: challenge.flowId });
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
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
          {selected && (
            <button
              className={`${button} bg-background`}
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
            </button>
          )}
          {!selected && (
            <button
              className={button}
              disabled={busy}
              onClick={() => void request({ type: "read" })}
            >
              {busy ? "Checking account…" : "Check account"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
