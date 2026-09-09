import { Redirect, Stack } from "expo-router";
import { useAuth } from "../../src/auth/provider";
import { Loading } from "../../src/ui";
export default function WorkspaceLayout() {
  const { me, loading } = useAuth();
  if (loading) return <Loading label="Restoring session…" />;
  if (!me) return <Redirect href="/sign-in" />;
  return <Stack screenOptions={{ headerShown: false, animation: "none" }} />;
}
