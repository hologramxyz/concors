import { useState } from "react";
import { Server } from "lucide-react";
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
import { ExistingMachines } from "./existing-machines";
import { MobileSelect } from "./select";
import { AppearanceSettings } from "@/settings/appearance-settings";
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
  page: SettingsPage | "machines";
  onPageChange(page: SettingsPage | "machines"): void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [withdrawingConsent, setWithdrawingConsent] = useState(false);
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
          onValueChange={(value) => onPageChange(value as SettingsPage | "machines")}
          groups={SETTINGS_NAV_GROUPS.map((group) => ({
            label: group.label,
            options: [
              ...group.items
                .filter((item) => item.page !== "billing")
                .filter((item) => !host.direct || ["appearance", "advanced"].includes(item.page))
                .map(({ page, label, icon: Icon }) => ({
                  value: page,
                  label,
                  icon: <Icon />,
                })),
              ...(group.label === "Workspace" && !host.direct
                ? [{ value: "machines", label: "Machines", icon: <Server /> }]
                : []),
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
          {host.direct ? (
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
                  state={connectionState}
                />
              )}
              <Section
                title="Direct desktop connection"
                description="Real sessions on your connected computer. Cloud account, billing and push settings are not part of this private test."
              >
                <p className="py-3 text-xs break-all text-muted-foreground">
                  Machine ID: {host.machineId ?? "Waiting for daemon…"}
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => void run(() => hostAction({ kind: "retry" }))}
                  >
                    Reconnect
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void run(() => hostAction({ kind: "sign-out" }))}
                  >
                    Disconnect desktop
                  </Button>
                </div>
                <p className="pt-3 text-sm text-muted-foreground">
                  Disconnecting does not stop agents or terminals.
                </p>
              </Section>
            </div>
          ) : page === "machines" && host.me ? (
            <ExistingMachines host={host} onConnected={() => onOpenChange(false)} />
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
                    Push delivery is not available on this server yet.
                  </p>
                )}
              </Section>
            </div>
          ) : host.me && page !== "machines" ? (
            <SettingsView
              page={page === "billing" ? "account" : page}
              endpoint={null}
              apiUrl={host.apiUrl}
              endpointLabel={host.endpointLabel}
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
              onSignOut={() => void run(() => hostAction({ kind: "sign-out" }))}
              onSetActiveOrganization={(organizationId) =>
                void run(() => hostAction({ kind: "switch-organization", organizationId }))
              }
            />
          ) : null}
          {!host.demo && (host.direct || page === "account") && (
            <div className="px-4 pb-4">
              <Section
                title="AI data sharing"
                description="Your messages, attachments and agent-read workspace content are shared with the AI provider configured on your machine."
              >
                {withdrawingConsent ? (
                  <div className="space-y-3 py-3">
                    <p className="text-sm text-muted-foreground">
                      This disconnects the phone and discards unsent chat drafts. Save open files
                      first. Agents already running continue; previously shared data is not deleted.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => setWithdrawingConsent(false)}
                      >
                        Keep my choice
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={busy}
                        onClick={() => void run(() => hostAction({ kind: "withdraw-ai-consent" }))}
                      >
                        Withdraw and disconnect
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    className="my-3"
                    variant="outline"
                    onClick={() => setWithdrawingConsent(true)}
                  >
                    Review AI data sharing
                  </Button>
                )}
              </Section>
            </div>
          )}
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
