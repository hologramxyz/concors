import { ApiError, type Organization } from "@concors/api-client";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { useSshKeys } from "@/data/ssh-keys";
import { api } from "@/auth/api";
import { describeAuthError } from "@/auth/auth-state";
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
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format-date";
import { Mono, Section } from "@/views/settings-primitives";

interface SshKeysSectionProps {
  readonly organization: Organization | undefined;
}

/** SSH public keys installed on every machine the organization creates from now on. */
export function SshKeysSection({ organization }: SshKeysSectionProps) {
  const organizationId = organization?.id;
  const query = useSshKeys(organizationId);
  const keys = query.data;
  const setKeys = query.resource.set;
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError ?? (query.error ? describeApiError(query.error) : null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  return (
    <Section
      title="SSH keys"
      description="Public keys installed on the machines of this organization. Keys are added to machines when they are created; existing machines keep the keys they were installed with."
    >
      {error && (
        <p role="alert" className="py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {keys === null && !error ? (
        <p role="status" className="py-2 text-sm text-muted-foreground">
          Loading keys…
        </p>
      ) : keys !== null && keys.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          No keys yet. Add one before creating a machine, or nobody will be able to log in to it.
        </p>
      ) : (
        <ul className="flex flex-col">
          {(keys ?? []).map((key) => (
            <li key={key.id} className="flex items-center justify-between gap-6 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium">
                  <KeyRound className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{key.name}</span>
                </div>
                <div className="selectable mt-0.5 truncate text-xs text-muted-foreground">
                  <Mono>{key.type}</Mono> · <Mono>{key.fingerprint}</Mono> · added{" "}
                  {formatDate(key.createdAt)}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${key.name}`}
                disabled={removing === key.id}
                onClick={() => {
                  setRemoving(key.id);
                  setError(null);
                  void api
                    .removeSshKey(key.id)
                    .then(() =>
                      setKeys((current) => (current ?? []).filter((k) => k.id !== key.id)),
                    )
                    .catch((cause: unknown) => setError(describeApiError(cause)))
                    .finally(() => setRemoving(null));
                }}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="py-2.5">
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add SSH key
        </Button>
      </div>

      {adding && (
        <AddSshKeyDialog
          onAdd={async (input) => {
            const key = await api
              .addSshKey(organizationId === undefined ? input : { ...input, organizationId })
              .catch((cause: unknown) => {
                throw new Error(describeApiError(cause));
              });
            setKeys((current) => [...(current ?? []), key]);
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </Section>
  );
}

function AddSshKeyDialog({
  onAdd,
  onClose,
}: {
  readonly onAdd: (input: { name: string; publicKey: string }) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add SSH key</DialogTitle>
          <DialogDescription>
            Paste a public key, usually the contents of <Mono>~/.ssh/id_ed25519.pub</Mono>. The
            private key never leaves your computer.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            setPending(true);
            setError(null);
            onAdd({
              name: String(data.get("name") ?? "").trim(),
              publicKey: String(data.get("publicKey") ?? "").trim(),
            })
              .then(onClose)
              .catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : "Could not add the key");
              })
              .finally(() => setPending(false));
          }}
        >
          <label className="block space-y-2 text-sm">
            <span>Name</span>
            <Input
              name="name"
              placeholder="Work laptop"
              required
              maxLength={64}
              autoFocus
              disabled={pending}
            />
          </label>
          <label className="block space-y-2 text-sm">
            <span>Public key</span>
            <Textarea
              name="publicKey"
              required
              rows={4}
              spellCheck={false}
              placeholder="ssh-ed25519 AAAA… you@laptop"
              className="font-mono text-xs"
              disabled={pending}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add key"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function describeApiError(cause: unknown): string {
  if (cause instanceof ApiError && cause.status < 500) return cause.message;
  return describeAuthError(cause);
}
