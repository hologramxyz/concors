import { useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useColorThemes } from "@/theme/color-theme-context";
import { Button } from "@/components/ui/button";
import { Section, SettingsCard } from "@/views/settings-primitives";

export function ColorThemeSettings() {
  const { themes, selected, select, mode, catalog, error, refresh } = useColorThemes();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyExample = async () => {
    if (!catalog) return;
    try {
      await navigator.clipboard.writeText(
        `Create a Concors color theme in this machine's theme directory:\n${catalog.directory}\n\nCreate the directory if needed, then save a file named my-theme.json. Use this JSON as a starting point:\n${JSON.stringify({ version: 1, id: "my-theme", name: "My theme", extends: "cobalt", light: { accent: "#3055bb" }, dark: { accent: "#a4bbff", terminal: { blue: "#a4bbff" } } }, null, 2)}\n\nUse a unique lowercase ID and six- or eight-digit hex colors. The app reloads files automatically; select the result in Settings → Appearance. No daemon restart is needed. Base palettes: concors, cobalt, dusk, forest, rose, sand, ocean. Both modes inherit unspecified colors from the base. You can override background, foreground, surface, sidebar, muted, mutedForeground, border, accent, accentForeground, selection, and terminal colors. Save atomically with a temporary file and rename when finished. Keep each JSON file below 32 KiB.`,
      );
      setCopyError(null);
      setCopied(true);
    } catch {
      setCopyError("Could not copy. Check clipboard access and try again.");
    }
  };
  return (
    <Section
      title="Color theme"
      description="Choose a palette for the workspace, agent chats, and terminals. Each includes light and dark colors."
    >
      <fieldset>
        <legend className="sr-only">Color theme</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {themes.map((theme) => {
            const c = theme[mode],
              active = theme.id === selected.id;
            return (
              <label
                key={theme.id}
                className="group relative min-w-0 cursor-pointer rounded-lg border p-2 transition-colors hover:bg-muted has-checked:border-primary has-focus-visible:ring-2 has-focus-visible:ring-ring"
              >
                <input
                  className="sr-only"
                  type="radio"
                  name="color-theme"
                  aria-label={theme.name}
                  checked={active}
                  onChange={() => select(theme.id)}
                />
                <span
                  aria-hidden="true"
                  className="flex h-20 overflow-hidden rounded-md border"
                  style={{ background: c.background, borderColor: c.border }}
                >
                  <span
                    className="flex w-1/4 shrink-0 flex-col gap-2 p-2"
                    style={{ background: c.sidebar }}
                  >
                    <span className="mt-1 h-1.5 rounded-full" style={{ background: c.accent }} />
                    <span
                      className="h-1 rounded-full"
                      style={{ background: c.mutedForeground, opacity: 0.6 }}
                    />
                    <span
                      className="h-1 w-2/3 rounded-full"
                      style={{ background: c.mutedForeground, opacity: 0.4 }}
                    />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col justify-center gap-2 p-2">
                    <span
                      className="h-1.5 w-3/4 rounded-full"
                      style={{ background: c.foreground, opacity: 0.85 }}
                    />
                    <span
                      className="h-1 w-full rounded-full"
                      style={{ background: c.mutedForeground, opacity: 0.55 }}
                    />
                    <span
                      className="flex h-5 items-center justify-end rounded border px-1"
                      style={{ background: c.surface, borderColor: c.border }}
                    >
                      <span className="size-2 rounded-full" style={{ background: c.accent }} />
                    </span>
                  </span>
                </span>
                <span className="mt-2 flex items-center gap-2 px-1 text-sm font-medium">
                  <span className="truncate">{theme.name}</span>
                  {active && <Check className="ml-auto size-4 shrink-0" aria-hidden="true" />}
                </span>
                <span className="mt-0.5 block px-1 pb-1 text-xs text-muted-foreground">
                  {theme.custom ? "Custom theme" : theme.description}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <SettingsCard className="mt-5 space-y-3 bg-muted/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Custom themes</h3>
          {catalog && (
            <Button variant="ghost" size="sm" onClick={refresh}>
              <RefreshCw /> Refresh themes
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Ask an agent to create a theme, or edit a JSON file yourself. Saved changes appear
          automatically.
        </p>
        {catalog ? (
          <>
            <code
              className="selectable block text-xs break-all text-muted-foreground"
              aria-label="Theme directory"
            >
              {catalog.directory}
            </code>
            <Button variant="outline" size="sm" onClick={() => void copyExample()}>
              <Copy /> {copied ? "Instructions copied" : "Copy theme instructions"}
            </Button>
            {catalog.issues.map((issue, index) => (
              <p role="status" key={`${issue.file}:${index}`} className="text-sm text-destructive">
                <span className="font-medium">{issue.file}:</span> {issue.message}
              </p>
            ))}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Connect to a machine with custom-theme support to load its files. Built-in palettes are
            always available.
          </p>
        )}
        {(error || copyError) && (
          <p role="status" className="text-sm text-destructive">
            {error ?? copyError}
          </p>
        )}
      </SettingsCard>
    </Section>
  );
}
