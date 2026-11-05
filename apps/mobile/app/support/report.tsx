import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../src/auth/provider";
import { api } from "../../src/auth/runtime";
import { Button, Copy, Field, Notice, Screen, useTheme } from "../../src/ui";
import { config } from "../../src/config";

const categories = {
  "ai-content": "AI content",
  bug: "App problem",
  privacy: "Privacy",
  security: "Security",
  other: "Other",
} as const;
export default function ReportScreen() {
  const auth = useAuth();
  const theme = useTheme();
  const params = useLocalSearchParams();
  const [category, setCategory] = useState<keyof typeof categories>("ai-content");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [received, setReceived] = useState<string | null>(null);
  const machineId = typeof params.machineId === "string" ? params.machineId : undefined;
  const submit = async () => {
    if (busy || message.trim().length < 10) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.reportContent({
        category,
        message: message.trim(),
        ...(machineId ? { machineId } : {}),
      });
      if (result.status !== "received" || !result.id)
        throw new Error("Could not read report confirmation");
      setReceived(result.id);
      setMessage("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not send your report. Try again or email gm@hologram.xyz.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: theme.background }}>
      <Screen
        title="Report content or a problem"
        action={
          <Button
            secondary
            disabled={busy}
            onPress={() => router.replace(auth.me || auth.direct ? "/(app)" : "/")}
          >
            Close
          </Button>
        }
      >
        <Copy>
          Tell the Hologram team about harmful AI content, a privacy concern or an app problem.
          Never include API keys, passwords or private customer code.
        </Copy>
        {received ? (
          <Notice>{`Report received. Reference: ${received}. We can follow up using your account email.`}</Notice>
        ) : auth.me && !config.demo ? (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {Object.entries(categories).map(([key, label]) => (
                <Button
                  key={key}
                  secondary={category !== key}
                  disabled={busy}
                  onPress={() => setCategory(key as keyof typeof categories)}
                >
                  {label}
                </Button>
              ))}
            </View>
            <Field
              label="What happened?"
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={4000}
              editable={!busy}
              style={{ minHeight: 160 }}
            />
            <Copy muted size={13}>
              Only your text, category
              {machineId ? ` and this machine reference (${machineId})` : ""} are sent with your
              account identity. Your conversation, attachments and code are not automatically
              included. Reports are removed with your account or within 30 days after resolution.
            </Copy>
            {error && <Notice>{error}</Notice>}
            <Button
              disabled={busy || message.trim().length < 10}
              onPress={() => {
                void submit();
              }}
            >
              {busy ? "Sending…" : "Send report"}
            </Button>
          </>
        ) : (
          <Copy muted>
            Sign in to send an in-app report, or contact us by email. Demo previews do not send
            reports.
          </Copy>
        )}
        <Button
          secondary
          onPress={() => {
            void Linking.openURL("mailto:gm@hologram.xyz?subject=Concors%20support").catch(() =>
              setError(
                "No email app is available. Contact gm@hologram.xyz from your email service.",
              ),
            );
          }}
        >
          Email gm@hologram.xyz
        </Button>
        {!auth.me && error && <Notice>{error}</Notice>}
        <Button
          secondary
          onPress={() => {
            void Linking.openURL(config.privacyUrl);
          }}
        >
          Privacy policy
        </Button>
      </Screen>
    </SafeAreaView>
  );
}
