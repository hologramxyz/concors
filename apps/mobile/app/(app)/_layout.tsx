import { Redirect, Tabs } from "expo-router";
import { useAuth } from "../../src/auth/provider";
import { Copy, Loading, useTheme } from "../../src/ui";

export default function TabLayout() {
  const { me, loading } = useAuth();
  const theme = useTheme();
  if (loading) return <Loading label="Restoring session…" />;
  if (!me) return <Redirect href="/sign-in" />;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.muted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Machines", tabBarIcon: ({ color }) => <Copy style={{ color }}>▣</Copy> }}
      />
      <Tabs.Screen
        name="workspace"
        options={{
          title: "Workspace",
          tabBarIcon: ({ color }) => <Copy style={{ color }}>▤</Copy>,
        }}
      />
      <Tabs.Screen
        name="agents"
        options={{ title: "Agents", tabBarIcon: ({ color }) => <Copy style={{ color }}>✳</Copy> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", tabBarIcon: ({ color }) => <Copy style={{ color }}>⚙</Copy> }}
      />
    </Tabs>
  );
}
