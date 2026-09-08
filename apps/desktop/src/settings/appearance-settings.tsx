import { Check, ChevronDown, Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THEME_PREFERENCES, type ThemePreference } from "@/theme/use-theme";
import { Row, Section } from "@/views/settings-primitives";

interface AppearanceSettingsProps {
  readonly theme: ThemePreference;
  readonly onSetTheme: (theme: ThemePreference) => void;
}

const THEME_LABEL: Record<ThemePreference, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor } as const;

export function AppearanceSettings({ theme, onSetTheme }: AppearanceSettingsProps) {
  const CurrentThemeIcon = THEME_ICON[theme];

  return (
    <Section
      title="Theme"
      description="Use one theme across your workspace, agent chats, and terminals."
    >
      <Row label="Interface theme" hint="Follow the system or choose one explicitly.">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Theme"
              variant="outline"
              size="sm"
              className="min-w-28 justify-between"
            >
              <span className="flex items-center gap-2">
                <CurrentThemeIcon aria-hidden="true" />
                {THEME_LABEL[theme]}
              </span>
              <ChevronDown className="opacity-60" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36">
            {THEME_PREFERENCES.map((option) => {
              const Icon = THEME_ICON[option];
              return (
                <DropdownMenuItem key={option} onSelect={() => onSetTheme(option)}>
                  <Icon aria-hidden="true" />
                  {THEME_LABEL[option]}
                  {option === theme && <Check className="ml-auto" aria-hidden="true" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </Row>
    </Section>
  );
}
