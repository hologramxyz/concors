import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Linking, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../auth/provider";
import { config } from "../config";
import { deviceStorage } from "../platform/storage";
import { Button, Card, Copy, Loading, Notice, Screen, useTheme } from "../ui";
import { AI_CONSENT_KEY, consentRecord, hasAIConsent } from "./consent";

interface ConsentValue {
  allowed: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
  accept(): Promise<void>;
  withdraw(): Promise<void>;
}
const ConsentContext = createContext<ConsentValue | null>(null);
export function useAIConsent() {
  const value = useContext(ConsentContext);
  if (!value) throw new Error("Missing AIConsentProvider");
  return value;
}

export function AIConsentProvider({ children }: { children: ReactNode }) {
  const { me, direct } = useAuth();
  const scope = direct
    ? `direct:${config.developmentDaemon}`
    : me
      ? `cloud:${config.apiUrl}:${me.user.id}:${me.session.activeOrganizationId ?? "none"}`
      : "";
  const [record, setRecord] = useState<{ scope: string; allowed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!scope || config.demo) return;
    void deviceStorage
      .get(AI_CONSENT_KEY)
      .then((raw) => {
        if (!cancelled) {
          setError(null);
          setRecord({ scope, allowed: hasAIConsent(raw, scope) });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecord({ scope, allowed: false });
          setError("Could not read your privacy preference. Review it before continuing.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);
  const allowed = config.demo || (!!scope && record?.scope === scope && record.allowed);
  return (
    <ConsentContext
      value={{
        allowed,
        loading: !!scope && !config.demo && record?.scope !== scope,
        busy,
        error,
        accept: async () => {
          if (busy || !scope) return;
          setBusy(true);
          setError(null);
          try {
            await deviceStorage.set(AI_CONSENT_KEY, consentRecord(scope));
            setRecord({ scope, allowed: true });
          } catch {
            setError("Could not save your choice. Please try again; no workspace was connected.");
          } finally {
            setBusy(false);
          }
        },
        withdraw: async () => {
          // Do not claim durable withdrawal if SecureStore could restore the old choice.
          await deviceStorage.set(AI_CONSENT_KEY, null);
          setRecord({ scope, allowed: false });
        },
      }}
    >
      {children}
    </ConsentContext>
  );
}

export function AIConsentScreen() {
  const consent = useAIConsent();
  const auth = useAuth();
  const theme = useTheme();
  const [linkError, setLinkError] = useState<string | null>(null);
  if (consent.loading) return <Loading label="Checking privacy preference…" />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <Screen title="Before you connect" subtitle="Your workspace and AI providers">
        <Card>
          <Copy weight="600">Choose what you share</Copy>
          <Copy>
            When you use an agent, your connected machine sends your messages, attachments, and
            workspace content read by its tools to that agent’s configured AI provider.
          </Copy>
          <Copy>
            Codex uses OpenAI; Claude Code uses Anthropic. OpenCode, Pi and custom agents use the
            provider configured on your machine, which may be another company or a local model.
            Check that configuration before sharing sensitive content.
          </Copy>
          <Copy muted>
            Provider data handling depends on your account and its settings. Only share code and
            files you are authorized to send. AI can make mistakes; review output and tool requests.
          </Copy>
        </Card>
        <Copy>
          Commands run on your connected machine, not on your phone. This choice permits data
          sharing through this app; it does not grant an agent additional tool permissions.
        </Copy>
        <Copy muted size={13}>
          You can withdraw this choice in Settings → AI data sharing. Disconnecting does not stop
          agents already running on other devices or delete information previously shared.
        </Copy>
        {(consent.error || linkError) && <Notice>{consent.error ?? linkError}</Notice>}
        <View style={{ gap: 12 }}>
          <Button
            testID="allow-ai-sharing"
            disabled={consent.busy}
            onPress={() => void consent.accept()}
          >
            {consent.busy ? "Saving your choice…" : "Allow AI data sharing"}
          </Button>
          <Button
            secondary
            disabled={consent.busy || auth.loading}
            onPress={() => void auth.signOut()}
          >
            Not now
          </Button>
          <Button
            secondary
            onPress={() => {
              void Linking.openURL(config.privacyUrl).catch(() =>
                setLinkError("Could not open the privacy policy. Please try again when connected."),
              );
            }}
          >
            Privacy policy
          </Button>
        </View>
      </Screen>
    </SafeAreaView>
  );
}
