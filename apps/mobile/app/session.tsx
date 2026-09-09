import { Redirect, useLocalSearchParams } from "expo-router";
import { useAuth } from "../src/auth/provider";
import { Loading } from "../src/ui";
import SignInScreen from "./index";
export default function SessionLink() {
  const { me, loading } = useAuth();
  const params = useLocalSearchParams();
  if (loading) return <Loading />;
  if (!me) return <SignInScreen />;
  return <Redirect href={{ pathname: "/(app)/workspace", params }} />;
}
