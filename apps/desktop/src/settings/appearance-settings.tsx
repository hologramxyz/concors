import { ColorThemeSettings } from "./color-theme-settings";
import { Monitor, Moon, Sun } from "lucide-react";
import { SettingsChoice } from "./settings-choice";
import { THEME_PREFERENCES, type ThemePreference } from "@/theme/use-theme";
import { CORNER_STYLES, type CornerStyle } from "@/theme/use-corner-style";
import { Row, Section, SettingsCard } from "@/views/settings-primitives";

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
  return (
    <>
      <Section title="Theme">
        <SettingsCard>
          <Row label="Interface theme">
            <SettingsChoice
              label="Theme"
              value={theme}
              options={THEME_PREFERENCES.map((value) => {
                const Icon = THEME_ICON[value];
                return { value, label: THEME_LABEL[value], icon: <Icon aria-hidden="true" /> };
              })}
              onChange={onSetTheme}
            />
          </Row>
        </SettingsCard>
      </Section>
      <ColorThemeSettings />
      <Section title="Interface">
        <SettingsCard className="p-4">
          <fieldset>
            <legend className="mb-3 text-sm font-medium">Corner style</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {CORNER_STYLES.map((style) => (
                <label
                  key={style}
                  className="flex cursor-pointer flex-row items-center gap-3 rounded-lg border px-3 py-3 hover:bg-muted/70 has-checked:border-primary has-checked:bg-muted has-focus-visible:ring-2 has-focus-visible:ring-ring sm:flex-col sm:py-4 sm:text-center"
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
                    className="h-8 w-12 shrink-0 border-2 border-current text-muted-foreground"
                    style={{ borderRadius: CORNER_OPTIONS[style].radius }}
                  />
                  <span className="text-xs font-medium">{CORNER_OPTIONS[style].label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </SettingsCard>
      </Section>
    </>
  );
}
