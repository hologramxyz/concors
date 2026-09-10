import { useId, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { TerminalProfileInputSchema, type SavedTerminalProfile } from "@concors/protocol";
import { useTerminalProfiles } from "@/terminal/profiles-context";
import { profileIcon } from "@/workspace/tab-profiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export function TerminalsSettings({
  creating,
  onCreatingChange,
}: {
  creating: boolean;
  onCreatingChange: (value: boolean) => void;
}) {
  const profiles = useTerminalProfiles();
  const [editing, setEditing] = useState<SavedTerminalProfile | null>(null);
  const close = () => {
    setEditing(null);
    onCreatingChange(false);
  };
  return (
    <section aria-label="Terminal profiles">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold">Terminal profiles</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={!profiles.canEdit}
          onClick={() => onCreatingChange(true)}
        >
          <Plus /> Add terminal profile
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Choose the commands you launch from the tab and pane menus. Profiles are saved on this
        machine and shared across your clients.
      </p>
      {!profiles.canEdit && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {profiles.supported
            ? "Reconnect to this machine to edit profiles."
            : "Connect to a machine with terminal profile support to edit profiles."}
        </p>
      )}
      <div className="mt-6 divide-y rounded-lg border">
        {profiles.profiles.map((profile) => {
          const Icon = profileIcon(profile.id);
          return (
            <div key={profile.id} className="flex items-center gap-3 p-4">
              <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{profile.name}</p>
                <p
                  className="mt-1 truncate font-mono text-xs text-muted-foreground"
                  title={[profile.command, ...profile.args].join(" ")}
                >
                  {[profile.command, ...profile.args].join(" ")}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${profile.name} profile`}
                disabled={!profiles.canEdit}
                onClick={() => setEditing(profile)}
              >
                <Pencil />
              </Button>
            </div>
          );
        })}
        {!profiles.profiles.length && (
          <p className="p-6 text-sm text-muted-foreground">
            Add a profile to launch your preferred commands.
          </p>
        )}
      </div>
      {(creating || editing) && <ProfileEditor profile={editing} onClose={close} />}
    </section>
  );
}

function ProfileEditor({
  profile,
  onClose,
}: {
  profile: SavedTerminalProfile | null;
  onClose: () => void;
}) {
  const profiles = useTerminalProfiles();
  const fieldId = useId();
  const [id] = useState(() => profile?.id ?? crypto.randomUUID());
  const [name, setName] = useState(profile?.name ?? "");
  const [command, setCommand] = useState(profile?.command ?? "");
  const [args, setArgs] = useState(profile?.args.join("\n") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const submit = async (remove = false) => {
    if (submitting.current || !profiles.canEdit) return;
    const parsed = TerminalProfileInputSchema.safeParse({
      id,
      name,
      command,
      args: args === "" ? [] : args.split("\n"),
    });
    if (!remove && !parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the profile fields.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      if (remove && profile)
        await profiles.execute({
          kind: "terminal-profile.remove",
          profileId: profile.id,
          expectedVersion: profile.version,
        });
      else if (parsed.success)
        await profiles.execute({
          kind: "terminal-profile.save",
          profile: parsed.data,
          expectedVersion: profile?.version ?? null,
        });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this profile.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting.current) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{profile ? "Edit terminal profile" : "Add terminal profile"}</DialogTitle>
            <DialogDescription>
              {profile
                ? "Changes apply when you open a new terminal. Existing sessions keep their command."
                : "Run a command in a terminal from any workspace on this machine."}
            </DialogDescription>
          </DialogHeader>
          <div className="my-6 space-y-4">
            <div className="space-y-2">
              <label htmlFor={`${fieldId}-name`} className="text-sm font-medium">
                Name
              </label>
              <Input
                id={`${fieldId}-name`}
                autoFocus
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Development server"
                disabled={busy || !profiles.canEdit}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={`${fieldId}-command`} className="text-sm font-medium">
                Command
              </label>
              <Input
                id={`${fieldId}-command`}
                required
                maxLength={4096}
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="npm"
                spellCheck={false}
                disabled={busy || !profiles.canEdit}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={`${fieldId}-arguments`} className="text-sm font-medium">
                Arguments
              </label>
              <Textarea
                id={`${fieldId}-arguments`}
                value={args}
                onChange={(event) => setArgs(event.target.value)}
                placeholder={"run\ndev"}
                spellCheck={false}
                className="min-h-28 font-mono"
                aria-describedby="profile-arguments-help"
                disabled={busy || !profiles.canEdit}
              />
            </div>
            <p id="profile-arguments-help" className="text-xs text-muted-foreground">
              One argument per line. Spaces within a line are preserved; no extra quotes are needed.
            </p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            {profile && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-destructive"
                disabled={busy || !profiles.canEdit}
                onClick={() => void submit(true)}
              >
                <Trash2 /> Delete profile
              </Button>
            )}
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !profiles.canEdit}>
              {busy ? "Saving…" : "Save profile"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
