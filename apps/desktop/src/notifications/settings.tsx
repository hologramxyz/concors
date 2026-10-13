import { useCallback, useEffect, useState } from "react";
import { useNotificationPreferences, setNotificationPreferences } from "./preferences";
import {
  desktopNotice,
  notificationAccess,
  openNotificationSettings,
  requestNotificationAccess,
} from "./platform";
import { accessHint, errorMessage, type NotificationAccess } from "./access";
import { isTauri } from "@/tauri";
import { playAgentSound, unlockAudio } from "./sound";
import { Section, SettingsCard } from "@/views/settings-primitives";
import { Button } from "@/components/ui/button";

export function NotificationSettings({
  native = false,
  onSetSound,
}: { native?: boolean; onSetSound?(enabled: boolean): Promise<void> } = {}) {
  const preferences = useNotificationPreferences();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState<NotificationAccess>("unknown");
  const refresh = useCallback(() => {
    if (native) return;
    void notificationAccess()
      .then(setAccess)
      .catch(() => setAccess("unknown"));
  }, [native]);
  // Re-read on focus: people come back here from System Settings after changing the permission.
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause, "Something went wrong. Please try again."));
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const hint = accessHint(access, isTauri());
  return (
    <Section
      title="Agent notifications"
      description="Concors alerts you when an agent finishes or needs your input while you aren’t looking at it: the window is in the background, or another agent is on screen. Preferences apply to this device; unread indicators sync across devices."
    >
      <SettingsCard className="divide-y">
        <div className="p-4">
          <label className="flex items-center justify-between gap-6">
            <span>
              <span className="text-sm font-medium">Sound</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Distinct sounds for completion and requests for input.
              </span>
            </span>
            <input
              type="checkbox"
              aria-label="Agent sounds"
              disabled={busy}
              checked={preferences.sound}
              onChange={(event) => {
                const sound = event.target.checked;
                void run(async () => {
                  if (sound) await unlockAudio();
                  await onSetSound?.(sound);
                  setNotificationPreferences({ ...preferences, sound });
                });
              }}
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy}
              variant="outline"
              onClick={() =>
                void run(async () => {
                  await unlockAudio();
                  await playAgentSound("done");
                })
              }
            >
              Test completion sound
            </Button>
            <Button
              size="sm"
              disabled={busy}
              variant="outline"
              onClick={() =>
                void run(async () => {
                  await unlockAudio();
                  await playAgentSound("needs_input");
                })
              }
            >
              Test input sound
            </Button>
          </div>
        </div>
        {!native && (
          <div className="p-4">
            <label className="flex items-center justify-between gap-6">
              <span>
                <span className="text-sm font-medium">Desktop notifications</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  A banner for agents in chat panes. Agents running in a terminal pane play a sound
                  only.
                </span>
              </span>
              <input
                type="checkbox"
                aria-label="Desktop notifications"
                checked={preferences.desktop}
                disabled={busy || access === "unsupported"}
                onChange={(event) => {
                  const desktop = event.target.checked;
                  void run(async () => {
                    // Keep the choice even when the system says no: the status below explains
                    // how to allow it, and banners start once it does.
                    if (desktop && access === "not_asked") await requestNotificationAccess();
                    setNotificationPreferences({ ...preferences, desktop });
                  });
                }}
              />
            </label>
            {hint && (
              <div
                role="status"
                className={`mt-3 rounded-md border p-3 text-xs ${hint.tone === "ok" ? "text-muted-foreground" : "border-warning/40 bg-warning/10"}`}
              >
                {hint.text}
                {hint.action && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    className="mt-2 block"
                    onClick={() =>
                      void run(async () => {
                        if (hint.action === "settings") await openNotificationSettings();
                        else await requestNotificationAccess();
                      })
                    }
                  >
                    {hint.action === "settings" ? "Open System Settings" : "Allow notifications"}
                  </Button>
                )}
              </div>
            )}
            <Button
              size="sm"
              // The desktop app asks on the first notification; a browser only asks from the switch.
              disabled={
                busy ||
                access === "unsupported" ||
                access === "blocked" ||
                (!isTauri() && access !== "allowed")
              }
              variant="outline"
              className="mt-3"
              onClick={() =>
                void run(async () => {
                  const close = await desktopNotice(
                    {
                      id: crypto.randomUUID(),
                      sessionId: "test",
                      kind: "done",
                      title: "Concors notifications are ready",
                      body: "You’ll be notified when an agent needs your attention.",
                    },
                    () => undefined,
                  );
                  setTimeout(close, 8000);
                  setNotice(
                    "Test notification sent. If no banner appeared, check that Focus or Do Not Disturb is off.",
                  );
                })
              }
            >
              Test desktop notification
            </Button>
          </div>
        )}
      </SettingsCard>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {notice && <p className="mt-2 text-xs text-muted-foreground">{notice}</p>}
    </Section>
  );
}
