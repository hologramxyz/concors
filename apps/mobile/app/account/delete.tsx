import { Redirect, router } from "expo-router";
import { useState } from "react";
import { Alert, Linking, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../src/auth/provider";
import { api } from "../../src/auth/runtime";
import { nativeSignInPlatform } from "../../src/auth/sign-in-platform";
import { signInWithAuthSession } from "../../src/auth/sign-in";
import { deviceStorage, tokenStore } from "../../src/platform/storage";
import { Button, Copy, Field, Notice, Screen, useTheme } from "../../src/ui";
import { LAST_TARGETS_KEY } from "../../src/workspace/last-target";
import { config } from "../../src/config";

export default function DeleteAccountScreen() {
  const auth = useAuth();
  const theme = useTheme();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = useQuery({
    queryKey: ["account-deletion-plan", auth.me?.user.id],
    queryFn: () => api.getAccountDeletionPlan(),
    enabled: !!auth.me && !auth.direct && !config.demo,
    retry: false,
  });
  if (auth.initializing) return null;
  if (auth.direct || config.demo)
    return (
      <SafeAreaView
        edges={["top", "bottom"]}
        style={{ flex: 1, backgroundColor: theme.background }}
      >
        <Screen title="Delete account">
          <Copy>
            This preview has no signed-in Concors account to delete. Use the account deletion
            website for your real account.
          </Copy>
          <Button
            secondary
            onPress={() => {
              void Linking.openURL(config.deletionUrl);
            }}
          >
            Open account deletion
          </Button>
          <Button secondary onPress={() => router.replace("/(app)")}>
            Close
          </Button>
        </Screen>
      </SafeAreaView>
    );
  if (!auth.me)
    return <Redirect href={{ pathname: "/", params: { returnTo: "/account/delete" } }} />;
  const remove = async () => {
    if (busy || !plan.data || confirmation !== "DELETE" || !auth.me) return;
    const expectedUserId = auth.me.user.id;
    setBusy(true);
    setError(null);
    try {
      const platform = nativeSignInPlatform();
      if (!platform) throw new Error("Open the Concors app to verify your identity.");
      const outcome = await signInWithAuthSession(api, platform, undefined, expectedUserId);
      if (outcome === "cancelled") return;
      await tokenStore.flush();
      const receipt = await api.deleteAccount({
        confirmation: "DELETE",
        planToken: plan.data.planToken,
      });
      const saved = await deviceStorage.set("account-deletion-receipt.v1", receipt.receipt).then(
        () => true,
        () => false,
      );
      await deviceStorage.set(LAST_TARGETS_KEY, null).catch(() => undefined);
      await auth.signOut();
      router.replace("/");
      if (!saved)
        Alert.alert(
          "Deletion requested",
          "Your sessions have been revoked, but this device could not save your receipt. Open the private receipt page to bookmark it.",
          [
            { text: "Close", style: "cancel" },
            {
              text: "Open receipt",
              onPress: () => {
                void Linking.openURL(
                  `https://concors.dev/account/delete#receipt=${receipt.receipt}`,
                );
              },
            },
          ],
        );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not request account deletion");
      void auth.refresh().catch(() => undefined);
      void plan.refetch();
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: theme.background }}>
      <Screen
        title="Delete account"
        subtitle={auth.me.user.email}
        action={
          <Button secondary disabled={busy} onPress={() => router.replace("/(app)")}>
            Cancel
          </Button>
        }
      >
        <Copy>
          Delete your Concors account permanently across all devices. Your profile, linked
          identities, sessions, provider-account library and account-linked reports will be removed.
        </Copy>
        {error && <Notice>{error}</Notice>}
        {plan.isPending && <Copy muted>Loading affected resources…</Copy>}
        {plan.isError && (
          <>
            <Notice>Could not load deletion details. Your account has not been deleted.</Notice>
            <Button
              secondary
              onPress={() => {
                void plan.refetch();
              }}
            >
              Retry
            </Button>
          </>
        )}
        {plan.data?.organizations.map((org) => (
          <View key={org.id} style={{ gap: 8 }}>
            <Copy weight="600">{org.name}</Copy>
            <Copy>
              {org.action === "delete"
                ? "This organization will be deleted."
                : "You will leave this shared organization; its other members keep access."}
              {org.transferTo ? ` Ownership will transfer to ${org.transferTo.name}.` : ""}
            </Copy>
            {org.machines.map((machine) => (
              <Copy key={machine.id} muted>
                {machine.name}:{" "}
                {machine.alreadyEnded
                  ? "remove its historical record."
                  : machine.provider === "external"
                    ? "remove its registration; keep files on your computer."
                    : "erase the cloud disk and stop machine billing/renewal. Unused paid time is not automatically refunded."}
              </Copy>
            ))}
          </View>
        ))}
        <Copy muted>
          Your own computer and files are not wiped. Remove its daemon, provider credentials and
          management access yourself if you no longer need them. Separate AI-provider subscriptions
          remain yours to cancel. Previously issued machine-access tokens can remain valid until
          their short expiry.
        </Copy>
        <Copy muted>
          Cleanup retries if a provider is unavailable. A private receipt shows when it is complete.
          Financial records, logs and backups can be retained separately as described in the privacy
          policy.
        </Copy>
        <Button
          secondary
          onPress={() => {
            void Linking.openURL(config.privacyUrl);
          }}
        >
          Read privacy policy
        </Button>
        <Field
          label="Type DELETE to confirm"
          value={confirmation}
          onChangeText={setConfirmation}
          editable={!busy}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <Copy>
          This cannot be undone once cleanup finishes. Continue to verify your identity with the
          same account, then submit this deletion request.
        </Copy>
        <Button
          danger
          disabled={busy || confirmation !== "DELETE" || !plan.data}
          onPress={() => {
            void remove();
          }}
        >
          {busy ? "Verifying and requesting…" : "Verify identity and delete account"}
        </Button>
      </Screen>
    </SafeAreaView>
  );
}
