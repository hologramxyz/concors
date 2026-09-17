import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configureRequestIds } from "@concors/client-core";
import { randomUUID } from "expo-crypto";
import { AuthProvider, useAuth } from "../src/auth/provider";
import { MachineProvider } from "../src/connection/provider";
import { useTheme } from "../src/ui";
import { api } from "../src/auth/runtime";
import { useCapabilities } from "../src/queries";
import { usePushNavigation } from "../src/platform/notifications";
import { AppearanceProvider, useAppearance } from "../src/appearance-provider";

configureRequestIds(randomUUID);
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
export default function RootLayout() {
  useEffect(() => {
    focusManager.setFocused(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) =>
      focusManager.setFocused(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  const [query] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 15_000 }, mutations: { retry: false } },
      }),
  );
  return (
    <QueryClientProvider client={query}>
      <AppearanceProvider>
        <AuthProvider>
          <Navigation />
        </AuthProvider>
      </AppearanceProvider>
    </QueryClientProvider>
  );
}
function Navigation() {
  const { me, direct, loading } = useAuth();
  const { ready } = useAppearance();
  const capabilities = useCapabilities();
  usePushNavigation(api, me?.user.id, capabilities.data?.pushNotifications ?? false);
  useEffect(() => {
    // Hand off the OS splash to the matching React screen after appearance is restored.
    // Do not hold the unresponsive OS splash over a slow network request.
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  return (
    <MachineProvider
      direct={direct}
      enabled={!loading && (!!me || direct)}
      scope={`${me?.user.id ?? "signed-out"}:${me?.session.activeOrganizationId ?? "none"}`}
    >
      <AppStack />
    </MachineProvider>
  );
}
function AppStack() {
  const theme = useTheme();
  return (
    <>
      <StatusBar style={theme.dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.background },
          headerBackButtonDisplayMode: "minimal",
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="session" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
