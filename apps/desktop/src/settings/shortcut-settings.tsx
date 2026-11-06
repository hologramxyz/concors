import { useContext, useState } from "react";
import { CompactLayoutContext } from "@/components/compact-layout";
import { BINDINGS, isCompactCommand, type CommandId } from "@/shortcuts/bindings";
import { Row, Section, SettingsCard } from "@/views/settings-primitives";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FOLLOW_UP_MODES,
  setFollowUpMode,
  useFollowUpMode,
  type FollowUpMode,
} from "@/agents/follow-ups";
import { MOD_KEY } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShortcutEditor } from "@/shortcuts/editor";
import { useShortcutPreferences } from "@/shortcuts/preferences-context";
import { KeyChips, PlainKeys } from "@/shortcuts/key-chips";
import { bindingLabel, mainBinding, usableBindings } from "@/shortcuts/keymap";
import { isTauri } from "@/tauri";

const GROUPS: readonly {
  title: string;
  description?: string;
  compactDescription?: string;
  commands: readonly CommandId[];
}[] = [
  {
    title: "Workspace",
    commands: ["search", "new-project", "settings", "shortcuts"],
  },
  {
    title: "Agent chat",
    description: "Escape stops the running agent.",
    commands: ["start-dictation"],
  },
  {
    title: "Tabs",
    description: "Switch between tabs and organize your workspace.",
    compactDescription:
      "Move through the tabs in the strip under the header. Closing a tab closes only that view, not its desktop siblings.",
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
    description: "Arrow keys on a split divider resize panes.",
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

const CONTEXT_LABEL: Partial<Record<string, string>> = {
  tab: "focused tab",
  "outside-terminal": "outside terminals",
};

const FOLLOW_UP_LABEL: Record<FollowUpMode, string> = {
  steer: "Steer the current turn",
  queue: "Queue for after the turn",
};

/** What Enter does with a message written while an agent works. */
function FollowUpSettings() {
  const mode = useFollowUpMode();
  const compact = useContext(CompactLayoutContext);
  return (
    <Section
      title="Follow-ups"
      description="Slash commands, and agents that cannot be steered, always queue."
    >
      <SettingsCard>
        <Row
          label={compact ? "Sending while an agent works" : "Enter while an agent works"}
          // On a phone, ⌘/Ctrl+Enter is how an external keyboard sends at all.
          {...(compact ? {} : { hint: `${MOD_KEY}+Enter does the other.` })}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Follow-ups"
                variant="outline"
                size="sm"
                className="min-w-48 justify-between"
              >
                {FOLLOW_UP_LABEL[mode]}
                <ChevronDown className="opacity-60" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {FOLLOW_UP_MODES.map((option) => (
                <DropdownMenuItem key={option} onSelect={() => setFollowUpMode(option)}>
                  {FOLLOW_UP_LABEL[option]}
                  {option === mode && <Check className="ml-auto" aria-hidden="true" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Row>
      </SettingsCard>
    </Section>
  );
}

/** A row's shortcuts: the main one as chips, then on the same line in muted text any condition on
 * it, and any others with theirs. */
function ShortcutList({ id }: { id: CommandId }) {
  const { keymap, mac } = useShortcutPreferences();
  const main = mainBinding(keymap[id], isTauri());
  if (!main) return <span className="text-muted-foreground">Unassigned</span>;
  const others = usableBindings(keymap[id], isTauri()).filter((binding) => binding !== main);
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5 text-right">
      <KeyChips strokes={main.keys} mac={mac} />
      {main.context && CONTEXT_LABEL[main.context] && (
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          {CONTEXT_LABEL[main.context]}
        </span>
      )}
      {others.map((binding, index) => (
        <span
          key={index}
          className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground"
        >
          also <PlainKeys strokes={binding.keys} mac={mac} />
          {binding.context &&
            CONTEXT_LABEL[binding.context] &&
            ` ${CONTEXT_LABEL[binding.context]}`}
        </span>
      ))}
    </span>
  );
}

export function ShortcutSettings() {
  const compact = useContext(CompactLayoutContext);
  const preferences = useShortcutPreferences();
  const [editing, setEditing] = useState<CommandId | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = (id: CommandId) => {
    const label = BINDINGS.find((binding) => binding.id === id)?.label ?? id;
    return `${label} ${usableBindings(preferences.keymap[id], isTauri())
      .map((binding) => bindingLabel(binding, preferences.mac))
      .join(" ")}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  };
  return (
    <>
      <Section title="Keyboard shortcuts">
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
            Escape cancels a sequence. Closing a {compact ? "tab" : "pane or tab"} leaves its
            sessions running.
          </p>
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </SettingsCard>
      </Section>
      <FollowUpSettings />
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
                    <ShortcutList id={binding.id} />
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
