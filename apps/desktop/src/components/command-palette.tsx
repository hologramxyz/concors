import { LogOut, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import { useEffect } from "react";

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
  open,
  onOpenChange,
  onNavigate,
  onReconnect,
  canReconnect,
  onSetTheme,
  onSignOut,
}: CommandPaletteProps) {
  // ⌘K / Ctrl+K toggles the palette from anywhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

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

          <CommandGroup heading="Go to">
            {ALL_NAV.map((item) => {
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
                  {item.shortcut && <CommandShortcut>{item.shortcut}</CommandShortcut>}
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
