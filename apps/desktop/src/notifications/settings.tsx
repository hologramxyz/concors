import { useState } from "react";
import { useNotificationPreferences, setNotificationPreferences } from "./preferences";
import { notificationPermission, requestNotificationPermission, desktopNotice } from "./platform";
import { playAgentSound, unlockAudio } from "./sound";
import { Section, SettingsCard } from "@/views/settings-primitives";
import { Button } from "@/components/ui/button";

export function NotificationSettings({
  native = false,
  onSetSound,
}: { native?: boolean; onSetSound?(enabled: boolean): Promise<void> } = {}) {
  const preferences = useNotificationPreferences();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not enable notifications");
    } finally {
      setBusy(false);
    }
  };
  const permission = notificationPermission();
  return (
    <Section
      title="Agent notifications"
      description="Preferences apply to this device. Unread indicators sync across devices."
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
                  Notify when an agent you aren’t viewing finishes or needs input.
                </span>
              </span>
              <input
                type="checkbox"
                aria-label="Desktop notifications"
                checked={preferences.desktop}
                disabled={busy || permission === "unsupported"}
                onChange={(event) => {
                  const desktop = event.target.checked;
                  void run(async () => {
                    if (desktop && !(await requestNotificationPermission()))
                      throw new Error(
                        "Notifications are blocked. Allow them in your browser or system settings, then try again.",
                      );
                    setNotificationPreferences({ ...preferences, desktop });
                  });
                }}
              />
            </label>
            <Button
              size="sm"
              disabled={busy || permission !== "granted"}
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
                })
              }
            >
              Test desktop notification
            </Button>
            {permission === "unsupported" && (
              <p className="mt-2 text-xs text-muted-foreground">
                Desktop notifications aren’t supported by this browser.
              </p>
            )}
          </div>
        )}
      </SettingsCard>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </Section>
  );
}
