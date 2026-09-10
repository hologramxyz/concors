import { useContext } from "react";
import { CompactLayoutContext } from "@/components/compact-layout";
import {
  BINDINGS,
  isCompactCommand,
  isMac,
  shortcutLabel,
  type CommandId,
} from "@/shortcuts/bindings";
import { Section } from "@/views/settings-primitives";

const GROUPS: readonly {
  title: string;
  description: string;
  compactDescription?: string;
  commands: readonly CommandId[];
}[] = [
  {
    title: "Workspace",
    description: "Outside terminals, ⌘K / Ctrl+K also opens search.",
    commands: ["search", "new-project", "settings", "shortcuts"],
  },
  {
    title: "Tabs",
    description:
      "Use Alt+Shift+Left/Right on a tab to reorder it. The desktop app also supports Ctrl+Tab / Ctrl+Shift+Tab; browsers keep those for browser tabs.",
    compactDescription: "Use Tab and pane actions to rename, reorder or close tabs.",
    commands: ["new-tab", "previous-tab", "next-tab", "close-tab"],
  },
  {
    title: "Panes",
    description:
      "Ctrl+Shift+Arrow moves between panes, including from the Agent input. Other form fields keep their normal text-selection keys. Use arrow keys on a split divider to resize panes.",
    compactDescription:
      "Arrow commands select the previous or next pane in the top selector. Create and arrange split layouts on desktop.",
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
  return (
    <>
      <p className="mb-8 text-muted-foreground">
        {compact && "With an external keyboard, the same commands work on mobile. "}
        {isMac() && "On Mac, use the physical Control (⌃) key, not Command (⌘). "}
        Press a P or T shortcut, release the keys, then choose the next key. Escape cancels the
        sequence. Closing a pane or tab leaves its sessions running.
      </p>
      {GROUPS.map((group) => (
        <Section
          key={group.title}
          title={group.title}
          description={
            compact ? (group.compactDescription ?? group.description) : group.description
          }
        >
          <dl className="divide-y">
            {BINDINGS.filter(
              (binding) =>
                group.commands.includes(binding.id) && (!compact || isCompactCommand(binding.id)),
            ).map((binding) => (
              <div
                key={binding.id}
                className="flex flex-col items-start justify-between gap-2 py-3 sm:flex-row sm:items-center sm:gap-6"
              >
                <dt className="font-medium">{binding.label}</dt>
                <dd className="shrink-0">
                  <kbd className="rounded border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                    {shortcutLabel(binding.id)}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      ))}
    </>
  );
}
