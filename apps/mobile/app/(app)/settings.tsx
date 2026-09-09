import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../src/auth/provider";
import { api } from "../../src/auth/runtime";
import { useCapabilities } from "../../src/queries";
import { config } from "../../src/config";
import { Button, Card, Copy, Field, Notice, Screen, layout } from "../../src/ui";
import { enablePush, disablePush, pushEnabled } from "../../src/platform/notifications";

export default function SettingsScreen() {
  const auth = useAuth();
  const capabilities = useCapabilities();
  const organizations = useQuery({
    queryKey: ["organizations", auth.me?.user.id],
    queryFn: () => api.listOrganizations(),
    enabled: !!auth.me,
  });
  const [push, setPush] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const userId = auth.me?.user.id;
  useEffect(() => {
    let current = true;
    if (userId)
      void pushEnabled(userId)
        .then((enabled) => {
          if (current) setPush(enabled);
        })
        .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [userId]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not complete the request.");
    } finally {
      setBusy(false);
    }
  };
  const open = (url: string) => {
    void run(() => Linking.openURL(url));
  };
  return (
    <Screen title="Settings" subtitle="Your account and this device.">
      {message && <Notice>{message}</Notice>}
      {config.demo && <Notice>Demo preview · Changes here do not affect a real account.</Notice>}
      <Card>
        <Copy weight="600">{auth.me?.user.name}</Copy>
        <Copy muted>{auth.me?.user.email}</Copy>
        {organizations.data?.map((organization) => (
          <Button
            key={organization.id}
            secondary
            disabled={busy || organization.id === auth.me?.session.activeOrganizationId}
            onPress={() => {
              void run(async () => {
                await api.setActiveOrganization(organization.id);
                await auth.refresh();
              });
            }}
          >{`${organization.name}${organization.id === auth.me?.session.activeOrganizationId ? " · Active" : ""}`}</Button>
        ))}
        {organizations.isError && (
          <Copy muted size={13}>
            Could not load your organizations.
          </Copy>
        )}
      </Card>
      <Card>
        <Copy weight="600">Agent notifications</Copy>
        <Copy muted size={14}>
          Get notified when an agent finishes or needs your input. Notifications contain a generic
          message; code and prompts stay out of the payload.
        </Copy>
        {capabilities.data?.pushNotifications ? (
          <Button
            secondary
            disabled={busy}
            onPress={() => {
              void run(async () => {
                if (!auth.me) return;
                if (push) await disablePush(api);
                else await enablePush(api, auth.me.user.id);
                setPush(!push);
              });
            }}
          >
            {push ? "Disable notifications" : "Enable notifications"}
          </Button>
        ) : (
          <Copy muted size={13}>
            Push delivery is not available on this server yet.
          </Copy>
        )}
      </Card>
      <Card>
        <Copy weight="600">Help and privacy</Copy>
        <View style={layout.row}>
          <Button secondary onPress={() => open(config.supportUrl)}>
            Support
          </Button>
          <Button secondary onPress={() => open(config.privacyUrl)}>
            Privacy policy
          </Button>
        </View>
      </Card>
      <Card>
        <Copy weight="600">Delete account</Copy>
        <Copy muted size={14}>
          Request deletion of your account and associated data. The server must explain how active
          machines, shared organizations, subscriptions, and retained billing records are handled
          before deletion.
        </Copy>
        {!capabilities.data?.accountDeletion ? (
          <Copy muted size={13}>
            Account deletion is not available on this server yet. This preview is not ready for
            store submission until deletion is enabled.
          </Copy>
        ) : (
          <>
            {!deleting ? (
              <Button secondary onPress={() => setDeleting(true)}>
                Delete my account
              </Button>
            ) : (
              <>
                <Notice>
                  This affects your Concors account on every device. This action cannot be undone
                  once deletion is complete.
                </Notice>
                <Field
                  label="Confirm your password"
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                />
                <Field
                  label="Type DELETE to confirm"
                  value={confirmation}
                  onChangeText={setConfirmation}
                  autoCapitalize="characters"
                />
                <Button
                  danger
                  disabled={busy || confirmation !== "DELETE" || !password}
                  onPress={() => {
                    void run(async () => {
                      await api.deleteAccount(password);
                      await auth.signOut();
                    });
                  }}
                >
                  {busy ? "Requesting deletion…" : "Confirm account deletion"}
                </Button>
                <Button
                  secondary
                  disabled={busy}
                  onPress={() => {
                    setDeleting(false);
                    setPassword("");
                    setConfirmation("");
                  }}
                >
                  Cancel
                </Button>
              </>
            )}
          </>
        )}
      </Card>
      <Button
        secondary
        disabled={busy}
        onPress={() => {
          void run(auth.signOut);
        }}
      >
        Sign out
      </Button>
      <Copy muted size={12}>
        Concors 0.1.0 · Appearance follows your device.
      </Copy>
    </Screen>
  );
}
