import { LogOut, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import { useContext } from "react";
import { CompactLayoutContext } from "@/components/compact-layout";
import { useCommands } from "@/shortcuts/context";
import { isCompactCommand, shortcutLabel } from "@/shortcuts/bindings";
import type { WorkspaceProject } from "@concors/protocol";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { ALL_NAV, type View } from "@/navigation";
import type { ThemePreference } from "@/theme/use-theme";

interface CommandPaletteProps {
  readonly canSelectProject: boolean;
  readonly projects: readonly WorkspaceProject[];
  readonly onSelectProject: (id: string) => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onNavigate: (view: View) => void;
  readonly onReconnect: () => void;
  readonly canReconnect: boolean;
  readonly onSetTheme: (theme: ThemePreference) => void;
  readonly onSignOut: () => void;
}

const THEME_ITEMS = [
  { theme: "light", label: "Light", icon: Sun },
  { theme: "dark", label: "Dark", icon: Moon },
  { theme: "system", label: "System", icon: Monitor },
] as const;

export function CommandPalette({
  projects,
  canSelectProject,
  onSelectProject,
  open,
  onOpenChange,
  onNavigate,
  onReconnect,
  canReconnect,
  onSetTheme,
  onSignOut,
}: CommandPaletteProps) {
  const commands = useCommands();
  const compact = useContext(CompactLayoutContext);

  const run = (action: () => void) => () => {
    onOpenChange(false);
    action();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search for a page or action"
    >
      <Command>
        <CommandInput placeholder="Type a command or search…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>

          <CommandGroup heading="Workspace">
            {commands.items
              .filter((item) => item.id !== "search" && (!compact || isCompactCommand(item.id)))
              .map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.label}
                  disabled={!item.enabled}
                  onSelect={run(() => {
                    requestAnimationFrame(() => commands.run(item.id));
                  })}
                >
                  {item.label}
                  <CommandShortcut>{shortcutLabel(item.id)}</CommandShortcut>
                </CommandItem>
              ))}
          </CommandGroup>
          {projects.length > 0 && (
            <CommandGroup heading="Projects">
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  disabled={!canSelectProject}
                  value={`project ${project.name} ${project.directory}`}
                  onSelect={run(() => onSelectProject(project.id))}
                >
                  {project.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading="Go to">
            {ALL_NAV.filter((item) => item.view !== "settings").map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.view}
                  value={`go to ${item.label}`}
                  disabled={item.comingSoon ?? false}
                  onSelect={run(() => onNavigate(item.view))}
                >
                  <Icon aria-hidden="true" />
                  {item.label}
                  {item.comingSoon && <span className="text-muted-foreground">· soon</span>}
                </CommandItem>
              );
            })}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Daemon">
            <CommandItem
              value="reconnect daemon"
              disabled={!canReconnect}
              onSelect={run(onReconnect)}
            >
              <RefreshCw aria-hidden="true" />
              Reconnect to daemon
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Account">
            <CommandItem value="sign out of concors account" onSelect={run(onSignOut)}>
              <LogOut aria-hidden="true" />
              Sign out
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Appearance">
            {THEME_ITEMS.map(({ theme, label, icon: Icon }) => (
              <CommandItem
                key={theme}
                value={`theme ${label}`}
                onSelect={run(() => onSetTheme(theme))}
              >
                <Icon aria-hidden="true" />
                {label} theme
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
