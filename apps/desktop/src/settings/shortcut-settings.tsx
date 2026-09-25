import { useContext, useState } from "react";
import { CompactLayoutContext } from "@/components/compact-layout";
import { BINDINGS, isCompactCommand, isMac, type CommandId } from "@/shortcuts/bindings";
import { Section, SettingsCard } from "@/views/settings-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShortcutEditor } from "@/shortcuts/editor";
import { useShortcutPreferences } from "@/shortcuts/preferences-context";
import { bindingLabel } from "@/shortcuts/keymap";

const GROUPS: readonly {
  title: string;
  description: string;
  compactDescription?: string;
  commands: readonly CommandId[];
}[] = [
  {
    title: "Workspace",
    description: "Search, create workspaces, and open settings.",
    commands: ["search", "new-project", "settings", "shortcuts"],
  },
  {
    title: "Tabs",
    description:
      "Switch between tabs and organize your workspace. Desktop-only bindings leave browser tabs alone.",
    compactDescription:
      "Move through the flat Tabs list. Closing a tab closes only that view, not its desktop siblings.",
    commands: [
      "new-tab",
      "resume-chat",
      "previous-tab",
      "next-tab",
      "close-tab",
      "rename-tab",
      "move-tab-left",
      "move-tab-right",
    ],
  },
  {
    title: "Panes",
    description:
      "Navigate between panes, including from terminal and Agent inputs. Other form fields retain normal editing keys. Arrow keys on a split divider resize panes.",
    commands: [
      "new-pane",
      "split-left",
      "split-horizontal",
      "split-up",
      "split-vertical",
      "focus-left",
      "focus-right",
      "focus-up",
      "focus-down",
      "close-pane",
    ],
  },
];

export function ShortcutSettings() {
  const compact = useContext(CompactLayoutContext);
  const preferences = useShortcutPreferences();
  const [editing, setEditing] = useState<CommandId | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = (id: CommandId) => {
    const label = BINDINGS.find((binding) => binding.id === id)?.label ?? id;
    return `${label} ${preferences.keymap[id].map((binding) => bindingLabel(binding, preferences.mac)).join(" ")}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  };
  return (
    <>
      <Section
        title="Keyboard shortcuts"
        description="Customize shortcuts for this device. Changes apply immediately after saving."
      >
        <SettingsCard className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              className="min-w-0 flex-1 basis-56"
              aria-label="Filter shortcuts"
              placeholder="Find a command or shortcut…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={busy || !Object.keys(preferences.overrides).length}
              onClick={() => {
                setBusy(true);
                setError(null);
                void preferences
                  .save({})
                  .catch((cause: unknown) =>
                    setError(
                      cause instanceof Error ? cause.message : "Could not restore shortcuts.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Restoring…" : "Restore all defaults"}
            </Button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {compact && "An external keyboard can use these commands on mobile. "}
            {isMac() && "Default Mac bindings use Control (⌃), not Command (⌘). "}
            For sequences, release the first combination before pressing the next key. Escape
            cancels a sequence. Closing a {compact ? "tab" : "pane or tab"} leaves its sessions
            running.
          </p>
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </SettingsCard>
      </Section>
      {!BINDINGS.some(
        (binding) => matches(binding.id) && (!compact || isCompactCommand(binding.id)),
      ) && (
        <p role="status" className="text-muted-foreground">
          No shortcuts match your search.
        </p>
      )}
      {GROUPS.filter((group) =>
        group.commands.some((id) => matches(id) && (!compact || isCompactCommand(id))),
      ).map((group) => (
        <Section
          key={group.title}
          title={group.title}
          description={
            compact ? (group.compactDescription ?? group.description) : group.description
          }
        >
          <SettingsCard>
            <dl className="divide-y">
              {BINDINGS.filter(
                (binding) =>
                  group.commands.includes(binding.id) &&
                  matches(binding.id) &&
                  (!compact || isCompactCommand(binding.id)),
              ).map((binding) => (
                <div
                  key={binding.id}
                  className="flex flex-col items-start justify-between gap-2 px-4 py-3.5 md:flex-row md:items-center md:gap-6"
                >
                  <dt className="font-medium">{binding.label}</dt>
                  <dd className="flex max-w-full flex-wrap items-center justify-end gap-2">
                    {preferences.keymap[binding.id].map((shortcut, index) => (
                      <span key={index} className="flex flex-col gap-1 text-right">
                        <kbd className="rounded border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                          {bindingLabel(shortcut, preferences.mac)}
                        </kbd>
                        {shortcut.context !== "app" && (
                          <span className="text-xs text-muted-foreground">
                            {shortcut.context === "native"
                              ? "Desktop app only"
                              : shortcut.context === "tab"
                                ? "Focused tab"
                                : "Outside terminals"}
                          </span>
                        )}
                      </span>
                    ))}
                    {!preferences.keymap[binding.id].length && (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                    <Button
                      variant="outline"
                      aria-label={`Edit ${binding.label} shortcuts`}
                      onClick={() => setEditing(binding.id)}
                    >
                      Edit
                    </Button>
                  </dd>
                </div>
              ))}
            </dl>
          </SettingsCard>
        </Section>
      ))}
      {editing && <ShortcutEditor key={editing} id={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
