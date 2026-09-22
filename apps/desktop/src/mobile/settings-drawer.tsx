import { ProvidersSettings } from "@/settings/providers-settings";
import { SubscriptionsSettings } from "@/settings/subscriptions-settings";
import { useState } from "react";
import type { ConnectionState } from "@concors/daemon-client";
import type { MobileState } from "@concors/client-core";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SettingsView } from "@/views/settings-view";
import { SETTINGS_NAV_GROUPS, type SettingsPage } from "@/settings/navigation";
import { Section } from "@/views/settings-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hostAction } from "./bridge";
import { NotificationSettings } from "@/notifications/settings";
import { MachinesSettings } from "./machines-settings";
import { MobileSelect } from "./select";
import { AppearanceSettings } from "@/settings/appearance-settings";
import { ShortcutSettings } from "@/settings/shortcut-settings";
import { AdvancedSettings } from "@/settings/advanced-settings";

export function SettingsDrawer({
  open,
  onOpenChange,
  host,
  connectionState,
  page,
  onPageChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  host: MobileState;
  connectionState: ConnectionState;
  page: SettingsPage;
  onPageChange(page: SettingsPage): void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update settings");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          onOpenChange(next);
          setPassword("");
          setConfirmation("");
          setDeleting(false);
        }
      }}
    >
      <DialogContent className="mobile-settings-drawer">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            {host.direct
              ? "Your connected desktop and this device."
              : "Your account and this device."}
          </DialogDescription>
        </DialogHeader>
        <MobileSelect
          label="Settings section"
          value={page}
          onValueChange={(value) => onPageChange(value as SettingsPage)}
          groups={SETTINGS_NAV_GROUPS.map((group) => ({
            label: group.label,
            options: [
              ...group.items
                .filter((item) => item.page !== "billing")
                .filter(
                  (item) =>
                    !host.direct ||
                    [
                      "appearance",
                      "shortcuts",
                      "advanced",
                      "providers",
                      "subscriptions",
                      "machines",
                    ].includes(item.page),
                )
                .map(({ page, label, icon: Icon }) => ({
                  value: page,
                  label,
                  icon: <Icon />,
                })),
            ],
          })).filter((group) => group.options.length)}
        />
        <div className="mobile-settings-body">
          {error && (
            <p role="alert" className="px-4 text-sm text-destructive">
              {error}
            </p>
          )}
          {host.demo && (
            <p className="px-4 text-xs text-muted-foreground">
              Demo · Account actions are simulated.
            </p>
          )}
          {page === "machines" ? (
            <MachinesSettings host={host} onConnected={() => onOpenChange(false)} />
          ) : page === "providers" ? (
            <div className="p-4">
              <ProvidersSettings />
            </div>
          ) : page === "subscriptions" ? (
            <div className="p-4">
              <SubscriptionsSettings />
            </div>
          ) : page === "shortcuts" ? (
            <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
              <ShortcutSettings />
            </div>
          ) : host.direct ? (
            <div className="space-y-5 p-4">
              {page === "appearance" ? (
                <AppearanceSettings
                  theme={host.preferences.theme}
                  cornerStyle={host.preferences.corners}
                  onSetTheme={(theme) =>
                    void run(() =>
                      hostAction({
                        kind: "preferences",
                        preferences: { ...host.preferences, theme },
                      }),
                    )
                  }
                  onSetCornerStyle={(corners) =>
                    void run(() =>
                      hostAction({
                        kind: "preferences",
                        preferences: { ...host.preferences, corners },
                      }),
                    )
                  }
                />
              ) : (
                <AdvancedSettings
                  endpoint={null}
                  endpointLabel={host.endpointLabel}
                  apiUrl={host.apiUrl}
                  {...(host.app
                    ? { clientVersion: host.app.version, buildVersion: host.app.build }
                    : {})}
                  state={connectionState}
                />
              )}
            </div>
          ) : page === "notifications" ? (
            <div className="p-4">
              <NotificationSettings
                native
                onSetSound={async (sound) => {
                  await hostAction({
                    kind: "preferences",
                    preferences: { ...host.preferences, sound },
                  });
                }}
              />
              <Section
                title="Agent notifications"
                description="Get notified when an agent finishes or needs your input. Code and prompts stay out of notification payloads."
              >
                <label className="flex items-center justify-between gap-4 py-4">
                  <span>Push notifications</span>
                  <input
                    type="checkbox"
                    aria-label="Push notifications"
                    checked={host.pushEnabled}
                    disabled={busy || !host.capabilities.pushNotifications}
                    onChange={(event) =>
                      void run(() => hostAction({ kind: "push", enabled: event.target.checked }))
                    }
                  />
                </label>
                {!host.capabilities.pushNotifications && (
                  <p className="text-sm text-muted-foreground">
                    {host.app?.personalTeam
                      ? "Push notifications are disabled in this free Personal Team build."
                      : "Push delivery is not available on this server yet."}
                  </p>
                )}
              </Section>
            </div>
          ) : host.me ? (
            <SettingsView
              page={page === "billing" ? "account" : page}
              endpoint={null}
              apiUrl={host.apiUrl}
              endpointLabel={host.endpointLabel}
              {...(host.app
                ? { clientVersion: host.app.version, buildVersion: host.app.build }
                : {})}
              state={connectionState}
              theme={host.preferences.theme}
              cornerStyle={host.preferences.corners}
              onSetTheme={(theme) =>
                void run(() =>
                  hostAction({ kind: "preferences", preferences: { ...host.preferences, theme } }),
                )
              }
              onSetCornerStyle={(corners) =>
                void run(() =>
                  hostAction({
                    kind: "preferences",
                    preferences: { ...host.preferences, corners },
                  }),
                )
              }
              auth={{ status: "signed-in", ...host.me, organizations: host.organizations }}
              onSetActiveOrganization={(organizationId) =>
                hostAction({ kind: "switch-organization", organizationId })
              }
            />
          ) : null}
          {page === "account" && !host.direct && (
            <div className="px-4 pb-4">
              <Section title="Help and privacy" description="Concors support and data practices.">
                <div className="flex gap-3 py-3">
                  <Button
                    variant="outline"
                    onClick={() =>
                      void run(() => hostAction({ kind: "open-url", url: host.supportUrl }))
                    }
                  >
                    Support
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void run(() => hostAction({ kind: "open-url", url: host.privacyUrl }))
                    }
                  >
                    Privacy policy
                  </Button>
                </div>
              </Section>
              <Section
                title="Delete account"
                description="Account deletion affects all devices. The server must explain retention, shared organizations and active subscriptions before deletion."
              >
                {!host.capabilities.accountDeletion ? (
                  <p className="py-3 text-sm text-muted-foreground">
                    Account deletion is not available on this server yet.
                  </p>
                ) : !deleting ? (
                  <Button variant="outline" onClick={() => setDeleting(true)}>
                    Delete my account
                  </Button>
                ) : (
                  <div className="space-y-3 py-3">
                    <p className="text-sm text-destructive">
                      This cannot be undone once deletion is complete.
                    </p>
                    <label className="block space-y-1">
                      Confirm your password
                      <Input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete="current-password"
                      />
                    </label>
                    <label className="block space-y-1">
                      Type DELETE to confirm
                      <Input
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.target.value)}
                      />
                    </label>
                    <Button
                      variant="destructive"
                      disabled={busy || confirmation !== "DELETE" || !password}
                      onClick={() =>
                        void run(() =>
                          hostAction({ kind: "delete-account", password, confirmation: "DELETE" }),
                        )
                      }
                    >
                      Confirm account deletion
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setDeleting(false);
                        setPassword("");
                      }}
                    >
                      Cancel deletion
                    </Button>
                  </div>
                )}
              </Section>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
