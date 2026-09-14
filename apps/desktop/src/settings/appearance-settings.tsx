import { ColorThemeSettings } from "./color-theme-settings";
import { Check, ChevronDown, Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THEME_PREFERENCES, type ThemePreference } from "@/theme/use-theme";
import { CORNER_STYLES, type CornerStyle } from "@/theme/use-corner-style";
import { Row, Section } from "@/views/settings-primitives";

interface AppearanceSettingsProps {
  readonly theme: ThemePreference;
  readonly onSetTheme: (theme: ThemePreference) => void;
  readonly cornerStyle: CornerStyle;
  readonly onSetCornerStyle: (style: CornerStyle) => void;
}

const THEME_LABEL: Record<ThemePreference, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor } as const;

const CORNER_OPTIONS = {
  square: { label: "Square", radius: "0px" },
  subtle: { label: "Slightly rounded", radius: "4px" },
  rounded: { label: "Rounded", radius: "10px" },
} satisfies Record<CornerStyle, { label: string; radius: string }>;

export function AppearanceSettings({
  theme,
  onSetTheme,
  cornerStyle,
  onSetCornerStyle,
}: AppearanceSettingsProps) {
  const CurrentThemeIcon = THEME_ICON[theme];

  return (
    <>
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
      <ColorThemeSettings />
      <Section
        title="Interface"
        description="Choose the corner style for frames, tabs, buttons, menus, and agent inputs."
      >
        <fieldset>
          <legend className="mb-3 font-medium">Corner style</legend>
          <div className="grid grid-cols-3 gap-3">
            {CORNER_STYLES.map((style) => (
              <label
                key={style}
                className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border px-2 py-4 text-center hover:bg-muted has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring"
              >
                <input
                  type="radio"
                  name="corner-style"
                  value={style}
                  checked={style === cornerStyle}
                  onChange={() => onSetCornerStyle(style)}
                  className="sr-only"
                />
                {/* These samples retain each option's shape so the choices stay recognizable. */}
                <span
                  aria-hidden="true"
                  data-corner-preview={style}
                  className="h-8 w-12 border-2 border-current text-muted-foreground"
                  style={{ borderRadius: CORNER_OPTIONS[style].radius }}
                />
                <span className="text-xs font-medium">{CORNER_OPTIONS[style].label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </Section>
    </>
  );
}
