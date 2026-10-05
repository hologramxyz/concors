import type { Machine } from "@concors/api-client";
import { Check, CircleCheck, Copy, LoaderCircle } from "lucide-react";
import { useState } from "react";

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

import { isValidMachineName, MACHINE_NAME_MAX_LENGTH } from "./format.ts";

/**
 * Connects a server the person already has instead of buying a VPS. Asking for a name creates the
 * machine and hands out a one-time command; running it on the server is all that is left, and this
 * dialog follows the machine (through the polled list) until the server has connected.
 */
export function ConnectServerDialog({
  organizationName,
  machine,
  command,
  onAdd,
  onClose,
}: {
  readonly organizationName: string;
  /** The machine waiting for its server, once added; kept current by the machine list. */
  readonly machine: Machine | null;
  /** Its setup command; only known right after adding or renewing it. */
  readonly command: string | null;
  /** Adds the machine; rejects with a message to show. */
  readonly onAdd: (name: string) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOk = isValidMachineName(name);
  const connected = machine !== null && machine.status === "running";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent size="wide">
        <DialogHeader>
          <DialogTitle>
            {machine ? `Connect ${machine.name}` : "Connect your own server"}
          </DialogTitle>
          <DialogDescription>
            Use a server you already have for{" "}
            <span className="font-medium text-foreground">{organizationName}</span>. Concors sets it
            up like one of its own VPS, at no charge.
          </DialogDescription>
        </DialogHeader>

        {command === null ? (
          <form
            id="connect-server"
            className="space-y-5"
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
                onChange={(event) => setName(event.target.value.trim())}
                placeholder="home-server"
                autoFocus
                required
                maxLength={MACHINE_NAME_MAX_LENGTH}
                disabled={pending}
                aria-invalid={name !== "" && !nameOk}
                className="h-10"
              />
              <span className="block text-xs text-muted-foreground">
                Lowercase letters, digits and hyphens.
              </span>
            </label>
            <div className="space-y-2 text-sm">
              <p className="font-medium">Your server needs</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>Ubuntu or Debian, on x86_64</li>
                <li>An SSH server and internet access</li>
                <li>
                  That's it: behind a home router or a firewall works too, through the Concors relay
                </li>
              </ul>
            </div>
          </form>
        ) : (
          <div className="space-y-5 text-sm">
            <div className="space-y-2">
              <p className="font-medium">Run this on your server</p>
              <div className="flex min-w-0 items-start gap-2 rounded-lg border bg-muted/30 p-3">
                <code className="selectable min-w-0 flex-1 font-mono text-xs break-all">
                  {command}
                </code>
                <CopyCommandButton text={command} />
              </div>
              <p className="text-xs text-muted-foreground">
                It works once. It makes sure there is an <code>ubuntu</code> user with sudo, gives
                Concors SSH access to it and connects the server. Your existing users and keys are
                left as they are.
              </p>
            </div>
            {connected ? (
              <p role="status" className="flex items-start gap-2.5">
                <CircleCheck
                  className="mt-0.5 size-4 shrink-0 text-emerald-500"
                  aria-hidden="true"
                />
                <span>Connected. Concors is finishing the setup; you can close this.</span>
              </p>
            ) : (
              <p role="status" className="flex items-start gap-2.5 text-muted-foreground">
                <LoaderCircle
                  className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                <span>
                  Waiting for your server. If the command reports a problem, fix it and run it
                  again.
                </span>
              </p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm break-words text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          {command === null ? (
            <>
              <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" form="connect-server" disabled={!nameOk || pending}>
                {pending ? "Adding…" : "Get setup command"}
              </Button>
            </>
          ) : (
            <Button type="button" variant={connected ? "default" : "outline"} onClick={onClose}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyCommandButton({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={failed ? "Copy failed; select the command and copy it" : "Copy setup command"}
      title={failed ? "Could not copy. Select the command and copy it manually." : undefined}
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
    </Button>
  );
}
