import { Redirect, Stack } from "expo-router";
import { useAuth } from "../../src/auth/provider";
import { Loading } from "../../src/ui";
import { AIConsentScreen, useAIConsent } from "../../src/privacy/provider";
export default function WorkspaceLayout() {
  const { me, loading, direct } = useAuth();
  const consent = useAIConsent();
  if (loading) return <Loading label="Restoring session…" />;
  if (!me && !direct) return <Redirect href="/sign-in" />;
  if (!consent.allowed) return <AIConsentScreen />;
  return <Stack screenOptions={{ headerShown: false, animation: "none" }} />;
}
