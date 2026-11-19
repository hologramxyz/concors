import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Play } from "lucide-react";
import {
  BUILT_IN_SOUNDS,
  getNotificationPreferences,
  useNotificationPreferences,
  setNotificationPreferences,
  type SoundChoice,
  type SoundEvent,
} from "./preferences";
import { saveCustomSound, CUSTOM_SOUND_EXTENSIONS } from "./custom-sounds";
import { SettingsChoice } from "@/settings/settings-choice";
import {
  desktopNotice,
  notificationAccess,
  openNotificationSettings,
  requestNotificationAccess,
} from "./platform";
import { accessHint, errorMessage, type NotificationAccess } from "./access";
import { isTauri } from "@/tauri";
import { playAgentSound, unlockAudio } from "./sound";
import { Row, Section, SettingsCard } from "@/views/settings-primitives";
import { Button } from "@/components/ui/button";

export function NotificationSettings({
  native = false,
  onSetSound,
  children,
}: {
  native?: boolean;
  onSetSound?(enabled: boolean): Promise<void>;
  /** Rows of the platform's own, such as the phone's push notifications, in the same card. */
  children?: ReactNode;
} = {}) {
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
      description="Alerts when an agent finishes or needs your input while you aren’t looking at it."
    >
      <SettingsCard className="divide-y">
        <div className="p-4">
          <label className="mobile-tap-target flex items-center justify-between gap-6">
            <span>
              <span className="text-sm font-medium">Sound</span>
            </span>
            <input
              type="checkbox"
              className="mobile-setting-toggle"
              aria-label="Agent sounds"
              disabled={busy}
              checked={preferences.sound}
              onChange={(event) => {
                const sound = event.target.checked;
                void run(async () => {
                  if (sound) await unlockAudio();
                  await onSetSound?.(sound);
                  setNotificationPreferences({ sound });
                });
              }}
            />
          </label>
        </div>
        {preferences.sound && (
          <>
            <SoundRow event="done" label="Agent finished" ownFile={!native} run={run} busy={busy} />
            <SoundRow
              event="needs_input"
              label="Needs your input"
              ownFile={!native}
              run={run}
              busy={busy}
            />
            <Row label="Volume">
              <label className="flex items-center gap-3">
                <input
                  type="range"
                  aria-label="Sound volume"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(preferences.volume * 100)}
                  className="w-40 accent-primary"
                  onChange={(event) =>
                    setNotificationPreferences({ volume: Number(event.target.value) / 100 })
                  }
                  // Previewing on release, not on every step of the drag.
                  onPointerUp={() =>
                    void run(async () => {
                      await unlockAudio();
                      await playAgentSound("done");
                    })
                  }
                />
                <span className="w-9 text-right text-xs tabular-nums">
                  {Math.round(preferences.volume * 100)}%
                </span>
              </label>
            </Row>
          </>
        )}
        {!native && (
          <div className="p-4">
            <label className="flex items-center justify-between gap-6">
              <span>
                <span className="text-sm font-medium">Desktop notifications</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Agents in a terminal pane play a sound only.
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
                    setNotificationPreferences({ desktop });
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
        {children}
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

/**
 * One event's sound: a built-in one, the person's own file, or none. Picking plays the sound, so
 * choosing by ear needs no extra click; the play button repeats it.
 */
function SoundRow({
  event,
  label,
  ownFile,
  run,
  busy,
}: {
  event: SoundEvent;
  label: string;
  /** The phone's web view has no lasting storage for a file, so it offers the built-in ones. */
  ownFile: boolean;
  run(action: () => Promise<void>): Promise<void>;
  busy: boolean;
}) {
  const preferences = useNotificationPreferences();
  const file = useRef<HTMLInputElement>(null);
  const value = preferences.sounds[event];
  const name = preferences.customNames[event];
  const play = (choice: SoundChoice) =>
    run(async () => {
      await unlockAudio();
      await playAgentSound(event, { choice });
    });
  const choose = (choice: SoundChoice) => {
    const current = getNotificationPreferences();
    setNotificationPreferences({ sounds: { ...current.sounds, [event]: choice } });
  };
  const options: { value: SoundChoice | "choose-file"; label: string }[] = [
    ...BUILT_IN_SOUNDS.map((sound) => ({ value: sound.id, label: sound.label })),
    ...(name && (ownFile || value === "custom")
      ? [{ value: "custom" as const, label: shortName(name) }]
      : []),
    ...(ownFile
      ? [{ value: "choose-file" as const, label: name ? "Choose another file…" : "Your own file…" }]
      : []),
    { value: "none", label: "None" },
  ];
  return (
    <Row label={label}>
      <div className="flex items-center gap-2">
        <SettingsChoice
          label={`${label} sound`}
          value={value}
          options={options}
          disabled={busy}
          onChange={(choice) => {
            // The file is stored before it is chosen, so cancelling the picker changes nothing.
            if (choice === "choose-file") return file.current?.click();
            choose(choice);
            if (choice !== "none") void play(choice);
          }}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Play ${label.toLowerCase()} sound`}
          disabled={busy || value === "none"}
          onClick={() => void play(value)}
        >
          <Play aria-hidden="true" />
        </Button>
        <input
          ref={file}
          type="file"
          hidden
          aria-label={`${label} sound file`}
          accept={`audio/*,${CUSTOM_SOUND_EXTENSIONS.map((extension) => `.${extension}`).join(",")}`}
          onChange={(change) => {
            const picked = change.target.files?.[0];
            change.target.value = "";
            if (!picked) return;
            void run(async () => {
              await saveCustomSound(event, picked);
              const current = getNotificationPreferences();
              setNotificationPreferences({
                sounds: { ...current.sounds, [event]: "custom" },
                customNames: { ...current.customNames, [event]: picked.name },
              });
              await unlockAudio();
              await playAgentSound(event, { choice: "custom" });
            });
          }}
        />
      </div>
    </Row>
  );
}

/** Keeps a long file name from stretching the picker, while its extension still shows. */
function shortName(name: string): string {
  return name.length <= 24 ? name : `${name.slice(0, 15)}…${name.slice(-8)}`;
}
