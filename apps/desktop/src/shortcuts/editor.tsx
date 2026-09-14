import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Shortcut, ShortcutStroke } from "@concors/client-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BINDINGS, type CommandId } from "./bindings";
import {
  bindingError,
  bindingLabel,
  browserWarning,
  conflictsFor,
  defaultKeymap,
  eventStroke,
  parseStroke,
  shortcutsConflict,
  strokeLabel,
  updateBindings,
} from "./keymap";
import { useShortcutPreferences } from "./preferences-context";

interface DraftBinding {
  id: string;
  keys: (ShortcutStroke | null)[];
  context: Shortcut["context"];
}
const draftBindings = (bindings: readonly Shortcut[]): DraftBinding[] =>
  bindings.map((binding) => ({ ...structuredClone(binding), id: crypto.randomUUID() }));
export function ShortcutEditor({ id, onClose }: { id: CommandId; onClose(): void }) {
  const preferences = useShortcutPreferences();
  const { keymap, overrides, mac } = preferences;
  const commandLabel = BINDINGS.find((command) => command.id === id)?.label ?? id;
  const [draft, setDraft] = useState<DraftBinding[]>(() => draftBindings(keymap[id]));
  const [manual, setManual] = useState(false);
  const [reassign, setReassign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = draft.every((binding) => binding.keys.every((key) => key !== null));
  const bindings: Shortcut[] = filled
    ? draft.map(({ keys, context }) => ({ keys: keys as ShortcutStroke[], context }))
    : [];
  const validation = !filled
    ? "Choose a key for each step."
    : bindings.map(bindingError).find(Boolean);
  const duplicate = bindings.some((binding, index) =>
    bindings.slice(index + 1).some((other) => shortcutsConflict(binding, other)),
  );
  const conflicts = conflictsFor(id, bindings, keymap);
  const warnings = [
    ...new Set(bindings.map((binding) => browserWarning(binding, mac)).filter(Boolean)),
  ];
  const update = (index: number, next: DraftBinding) => {
    setDraft((current) => current.map((binding, i) => (i === index ? next : binding)));
    setReassign(false);
    setError(null);
  };
  const save = async () => {
    if (busy || validation || duplicate || (conflicts.length && !reassign)) return;
    setBusy(true);
    setError(null);
    try {
      const defaults = defaultKeymap(mac)[id];
      const next = JSON.stringify(defaults) === JSON.stringify(bindings) ? undefined : bindings;
      await preferences.save(updateBindings(overrides, id, next, mac, reassign));
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save shortcuts. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="sm:max-w-xl"
        data-shortcut-editor
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Edit shortcut: {commandLabel}</DialogTitle>
          <DialogDescription>
            {manual
              ? "Type combinations such as Ctrl+Shift+K, Alt+ArrowLeft, or F6."
              : "Focus a key field and press the combination. Tab moves between fields; Escape stops recording."}{" "}
            Add a second step for a sequence. Removing every binding disables this command’s
            shortcuts.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Button variant="outline" onClick={() => setManual((value) => !value)} disabled={busy}>
            {manual ? "Record keys instead" : "Type combinations instead"}
          </Button>
          {draft.map((binding, index) => (
            <fieldset
              key={`${binding.id}:${manual}`}
              className="space-y-3 rounded-lg border p-3"
              disabled={busy}
            >
              <legend className="px-1 text-ui font-medium">Shortcut {index + 1}</legend>
              <div className="flex flex-wrap items-start gap-2">
                {binding.keys.map((key, step) => (
                  <div key={step} className="min-w-0 flex-1 basis-36">
                    <StrokeInput
                      label={`Shortcut ${index + 1}, ${step === 0 ? "first" : "second"} key`}
                      value={key}
                      mac={mac}
                      manual={manual}
                      onChange={(next) =>
                        update(index, {
                          ...binding,
                          keys: binding.keys.map((key, i) => (i === step ? next : key)),
                        })
                      }
                    />
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove shortcut ${index + 1}`}
                  onClick={() => {
                    setDraft((current) => current.filter((_, i) => i !== index));
                    setReassign(false);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  onClick={() =>
                    update(index, {
                      ...binding,
                      keys:
                        binding.keys.length === 1
                          ? [...binding.keys, null]
                          : binding.keys.slice(0, 1),
                    })
                  }
                >
                  {binding.keys.length === 1 ? "Add second step" : "Remove second step"}
                </Button>
                <label className="flex items-center gap-2 text-ui">
                  Scope
                  <select
                    aria-label={`Shortcut ${index + 1} scope`}
                    value={binding.context}
                    className="min-h-[28px] rounded-md border bg-background px-[8px] py-1"
                    onChange={(event) =>
                      update(index, {
                        ...binding,
                        context: event.target.value as Shortcut["context"],
                      })
                    }
                  >
                    <option value="app">App</option>
                    <option value="outside-terminal">Outside terminals</option>
                    <option value="native">Desktop app only</option>
                    <option value="tab">Focused tab</option>
                  </select>
                </label>
              </div>
            </fieldset>
          ))}
          {!draft.length && (
            <p className="text-muted-foreground">
              Unassigned. You can still use this action from the app’s menus.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || draft.length >= 4}
              onClick={() =>
                setDraft((current) => [
                  ...current,
                  { id: crypto.randomUUID(), keys: [null], context: "app" },
                ])
              }
            >
              <Plus aria-hidden="true" />
              Add shortcut
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDraft(draftBindings(defaultKeymap(mac)[id]));
                setReassign(false);
                setError(null);
              }}
            >
              Use defaults
            </Button>
          </div>
          {validation && (
            <p role="status" className="text-sm text-muted-foreground">
              {validation}
            </p>
          )}
          {duplicate && (
            <p role="alert" className="text-sm text-destructive">
              These shortcuts overlap. Remove the duplicate or choose a different second step.
            </p>
          )}
          {!!conflicts.length && (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <p>Already assigned:</p>
              <ul className="space-y-1">
                {conflicts.map((conflict) => (
                  <li key={`${conflict.id}:${conflict.index}`}>
                    {conflict.label}: {bindingLabel(conflict.binding, mac)}
                  </li>
                ))}
              </ul>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={reassign}
                  disabled={busy}
                  onChange={(event) => setReassign(event.target.checked)}
                />
                Reassign these shortcuts and remove the conflicting bindings from those commands.
              </label>
            </div>
          )}
          {warnings.map((warning) => (
            <p key={warning} role="status" className="text-sm text-muted-foreground">
              {warning}
            </p>
          ))}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !!validation || duplicate || (!!conflicts.length && !reassign)}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save shortcuts"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StrokeInput({
  label,
  value,
  mac,
  manual,
  onChange,
}: {
  label: string;
  value: ShortcutStroke | null;
  mac: boolean;
  manual: boolean;
  onChange(value: ShortcutStroke | null): void;
}) {
  const [typed, setTyped] = useState(value ? strokeLabel(value, mac) : "");
  return (
    <Input
      data-shortcut-recorder
      aria-label={label}
      readOnly={!manual}
      value={manual ? typed : value ? strokeLabel(value, mac) : ""}
      placeholder={manual ? "Ctrl+Shift+K" : "Press a key combination"}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => {
        setTyped(event.target.value);
        onChange(parseStroke(event.target.value));
      }}
      onKeyDown={(event) => {
        if (manual) return;
        if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") {
          event.currentTarget.blur();
          return;
        }
        if (event.repeat || event.getModifierState("AltGraph")) return;
        const stroke = eventStroke(event.nativeEvent);
        if (stroke) onChange(stroke);
      }}
    />
  );
}
