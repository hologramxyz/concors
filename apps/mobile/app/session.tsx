import { Redirect, useLocalSearchParams } from "expo-router";
import { useAuth } from "../src/auth/provider";
import { StartupScreen } from "../src/startup";
import { useAppearance } from "../src/appearance-provider";
import SignInScreen from "./index";
export default function SessionLink() {
  const { me, loading, direct } = useAuth();
  const params = useLocalSearchParams();
  const { ready } = useAppearance();
  if (!ready || loading) return <StartupScreen />;
  if (!me && !direct) return <SignInScreen />;
  return <Redirect href={{ pathname: "/(app)/workspace", params }} />;
}
