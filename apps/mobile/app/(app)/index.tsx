import { Redirect, useLocalSearchParams } from "expo-router";
export default function AppIndex() {
  const { view } = useLocalSearchParams();
  return (
    <Redirect
      href={{
        pathname: "/(app)/workspace",
        params: view === "workspaces" || view === "supervisor" ? { view } : {},
      }}
    />
  );
}
