import type { Machine } from "@concors/api-client";
import { cn } from "cn";
import { Check, ChevronDown, CircleAlert, CircleCheck, Copy, LoaderCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { copyText } from "@/lib/clipboard";

import {
  CONNECT_POLL_MS,
  connectStage,
  isRelayed,
  isValidMachineName,
  MACHINE_NAME_MAX_LENGTH,
  type ConnectStage,
} from "./format.ts";

/**
 * Connects a server the person already has instead of buying a VPS. Asking for a name creates the
 * machine and hands out a one-time command; the person runs it on the server, and this dialog
 * follows the machine until Concors is installed on it.
 *
 * Only the name and the command are in view. What servers work (and how to tell an ARM one) and
 * what the command does are there for whoever wants them, folded away.
 */
export function ConnectServerDialog({
  organizationName,
  machine,
  command,
  onAdd,
  onRefresh,
  onClose,
}: {
  readonly organizationName: string;
  /** The machine waiting for its server, once added; kept current by the machine list. */
  readonly machine: Machine | null;
  /** Its setup command; only known right after adding or renewing it. */
  readonly command: string | null;
  /** Adds the machine; rejects with a message to show. */
  readonly onAdd: (name: string) => Promise<void>;
  /** Re-reads the machine list, so the progress below moves without waiting for the slow poll. */
  readonly onRefresh: () => void;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOk = isValidMachineName(name);
  const stage = machine ? connectStage(machine) : "waiting";
  const following = command !== null && stage !== "ready";

  useEffect(() => {
    if (!following) return;
    const timer = setInterval(onRefresh, CONNECT_POLL_MS);
    return () => clearInterval(timer);
  }, [following, onRefresh]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent size="wide" className="gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b p-6 pr-14">
          <DialogTitle>
            {machine ? `Connect ${machine.name}` : "Connect your own server"}
          </DialogTitle>
          <DialogDescription>
            {command === null ? (
              <>
                Use a server you already have for{" "}
                <span className="font-medium text-foreground">{organizationName}</span>. Concors
                sets everything up for you, free of charge.
              </>
            ) : (
              "Run one command on your server. This window follows along."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-6">
          {command === null ? (
            <form
              id="connect-server"
              className="space-y-6"
              onSubmit={(event) => {
                event.preventDefault();
                if (!nameOk || pending) return;
                setPending(true);
                setError(null);
                onAdd(name)
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : "Could not add the server"),
                  )
                  .finally(() => setPending(false));
              }}
            >
              <label className="block space-y-2 text-sm">
                <span className="block font-medium">Name</span>
                <Input
                  name="name"
                  aria-label="Name"
                  value={name}
                  onChange={(event) => setName(event.target.value.trim().toLowerCase())}
                  placeholder="home-server"
                  autoFocus
                  required
                  maxLength={MACHINE_NAME_MAX_LENGTH}
                  disabled={pending}
                  aria-invalid={name !== "" && !nameOk}
                  className="h-10"
                />
                <span className="block text-xs text-muted-foreground">
                  How it appears in Concors. Lowercase letters, digits and hyphens.
                </span>
              </label>
              <Disclosure summary="Which servers work?">
                <p>Most do. Your server needs:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Ubuntu or Debian</li>
                  <li>
                    An x86_64 (Intel or AMD) processor. ARM servers aren&apos;t supported yet.
                  </li>
                  <li>SSH and internet access</li>
                </ul>
                <p>
                  Behind a home router or a firewall is fine: Concors then connects to it through
                  its relay, and your traffic stays encrypted end to end.
                </p>
                <div className="space-y-2 pt-1">
                  <p>Not sure which processor it has? Run this on the server:</p>
                  <CommandBox text="uname -m" label="Copy the check" compact />
                  <p>
                    <code className="font-mono text-foreground">x86_64</code> works.{" "}
                    <code className="font-mono text-foreground">aarch64</code> or{" "}
                    <code className="font-mono text-foreground">arm64</code> means ARM.
                  </p>
                </div>
              </Disclosure>
            </form>
          ) : (
            <>
              <ol className="space-y-5">
                <Step number={1} title="Open a terminal on your server">
                  For example over SSH, the way you usually log in to it.
                </Step>
                <Step number={2} title="Run this command">
                  <CommandBox text={command} label="Copy setup command" />
                  <span className="mt-2 block">
                    It works for this server only. If something goes wrong, fix it and run the same
                    command again.
                  </span>
                </Step>
              </ol>
              {machine && <ConnectProgress machine={machine} />}
              <Disclosure summary="What does this command do?">
                <ul className="list-disc space-y-1 pl-5">
                  <li>Checks the server runs Ubuntu or Debian on x86_64</li>
                  <li>
                    Makes sure there is an <code className="font-mono">ubuntu</code> user with sudo,
                    creating it if needed
                  </li>
                  <li>Adds Concors&apos; access key next to your own SSH keys</li>
                  <li>
                    If the internet can&apos;t reach the server, installs a small tunnel to the
                    Concors relay
                  </li>
                  <li>Then Concors installs itself and its coding agents</li>
                </ul>
                <p>
                  Your files, other users and SSH keys stay as they are. Removing the machine in
                  Concors takes its access away again.
                </p>
              </Disclosure>
            </>
          )}

          {error && (
            <p role="alert" className="text-sm break-words text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 min-w-0 flex-row items-center justify-end rounded-none">
          {command === null ? (
            <>
              <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" form="connect-server" disabled={!nameOk || pending}>
                {pending ? "Preparing…" : "Continue"}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant={stage === "ready" ? "default" : "outline"}
              onClick={onClose}
            >
              {stage === "ready" ? "Done" : "Finish later"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The three moments of a setup, the current one live. */
function ConnectProgress({ machine }: { readonly machine: Machine }) {
  const stage = connectStage(machine);
  const relayed = isRelayed(machine);
  const order: ConnectStage[] = ["waiting", "installing", "ready"];
  const at = order.indexOf(stage);
  const state = (step: ConnectStage): RowState => {
    const index = order.indexOf(step);
    if (index < at || stage === "ready") return "done";
    if (index > at) return "todo";
    if (step === "waiting" && machine.lastError) return "problem";
    if (step === "installing" && machine.agentError) return "problem";
    return "active";
  };
  return (
    <section
      aria-label="Setup progress"
      role="status"
      className="rounded-lg border bg-muted/20 p-4"
    >
      <ol className="space-y-3">
        <ProgressRow
          state={state("waiting")}
          title={stage === "waiting" ? "Waiting for your server" : "Server connected"}
          detail={
            stage === "waiting"
              ? (machine.lastError ?? "Updates here as soon as the command has run.")
              : relayed
                ? "Through the Concors relay: the internet can't reach it directly."
                : "Directly, over the internet."
          }
          problemHint={stage === "waiting" ? "Fix this, then run the same command again." : null}
        />
        <ProgressRow
          state={state("installing")}
          title="Installing Concors"
          detail={
            stage === "installing"
              ? (machine.agentError ?? "Takes a few minutes. You can close this; it carries on.")
              : null
          }
          problemHint={
            stage === "installing" ? "Concors tries again by itself in a few minutes." : null
          }
        />
        <ProgressRow
          state={state("ready")}
          title={stage === "ready" ? `${machine.name} is ready` : "Ready to use"}
          detail={stage === "ready" ? "Pick it from the machine switcher to start working." : null}
        />
      </ol>
    </section>
  );
}

type RowState = "done" | "active" | "problem" | "todo";

function ProgressRow({
  state,
  title,
  detail,
  problemHint = null,
}: {
  readonly state: RowState;
  readonly title: string;
  readonly detail: string | null;
  readonly problemHint?: string | null;
}) {
  return (
    <li className="flex items-start gap-3" data-state={state}>
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
        {state === "done" ? (
          <CircleCheck className="size-4 text-emerald-500" />
        ) : state === "active" ? (
          <LoaderCircle className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
        ) : state === "problem" ? (
          <CircleAlert className="size-4 text-amber-500" />
        ) : (
          <span className="size-2.5 rounded-full border border-muted-foreground/40" />
        )}
      </span>
      <div className="min-w-0 space-y-0.5">
        <p
          className={cn(
            "text-sm",
            state === "todo" ? "text-muted-foreground" : "font-medium text-foreground",
          )}
        >
          {title}
        </p>
        {detail && state !== "todo" && (
          <p
            className={cn(
              "text-xs break-words",
              state === "problem" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
            )}
          >
            {detail}
          </p>
        )}
        {state === "problem" && problemHint && (
          <p className="text-xs text-muted-foreground">{problemHint}</p>
        )}
      </div>
    </li>
  );
}

function Step({
  number,
  title,
  children,
}: {
  readonly number: number;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
      >
        {number}
      </span>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <p className="text-sm font-medium">{title}</p>
        <div className="text-xs text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

/** A folded section for details most people skip. */
function Disclosure({
  summary,
  children,
}: {
  readonly summary: string;
  readonly children: ReactNode;
}) {
  return (
    <details className="group rounded-lg border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm text-muted-foreground transition-colors select-none hover:bg-muted/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        {summary}
        <ChevronDown
          className="size-4 shrink-0 transition-transform duration-150 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="space-y-3 border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

/** A command to paste into a terminal, with a copy button that says when it worked. */
function CommandBox({
  text,
  label,
  compact = false,
}: {
  readonly text: string;
  readonly label: string;
  readonly compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg border bg-muted/40",
        compact ? "w-fit py-1 pr-1 pl-3" : "py-2 pr-2 pl-3",
      )}
    >
      <code
        className={cn(
          "selectable min-w-0 flex-1 font-mono break-all text-foreground",
          compact ? "text-xs" : "text-[13px] leading-relaxed",
        )}
      >
        {text}
      </code>
      <Button
        type="button"
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon-xs" : "sm"}
        className="shrink-0"
        aria-label={failed ? "Copy failed; select the text and copy it" : label}
        title={failed ? "Could not copy. Select the text and copy it manually." : undefined}
        onClick={() => {
          void copyText(text).then(
            () => {
              setCopied(true);
              setFailed(false);
              setTimeout(() => setCopied(false), 1500);
            },
            () => setFailed(true),
          );
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {!compact && (copied ? "Copied" : "Copy")}
      </Button>
    </div>
  );
}
