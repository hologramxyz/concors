import { Redirect, Stack } from "expo-router";
import { useAuth } from "../../src/auth/provider";
import { StartupScreen } from "../../src/startup";
import { useAppearance } from "../../src/appearance-provider";
export default function WorkspaceLayout() {
  const { me, loading, direct } = useAuth();
  const { ready } = useAppearance();
  if (!ready || loading) return <StartupScreen />;
  if (!me && !direct) return <Redirect href="/sign-in" />;
  return <Stack screenOptions={{ headerShown: false, animation: "none" }} />;
}
