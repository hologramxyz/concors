import { useState } from "react";
import { Redirect } from "expo-router";
import { Image, KeyboardAvoidingView, Linking, Platform, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../src/auth/provider";
import { config } from "../src/config";
import { Button, Copy, Field, Notice, Screen, useTheme } from "../src/ui";
import { useAppearance } from "../src/appearance-provider";
import { StartupScreen } from "../src/startup";

export default function SignInScreen() {
  const auth = useAuth();
  const theme = useTheme();
  const { ready } = useAppearance();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submit = () => auth.signIn(email, password);
  if (!ready || auth.initializing) return <StartupScreen />;
  if (auth.me || auth.direct) return <Redirect href="/(app)" />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <Screen title="Concors" subtitle="Your workspace, wherever you are.">
          <View style={{ paddingVertical: 28, gap: 20 }}>
            <Image
              source={require("../assets/icon.png")}
              style={{ width: 76, height: 76, borderRadius: theme.radius * 2.6 }}
              accessibilityLabel="Concors"
            />
            <Copy size={32} weight="600">
              Keep your work{`\n`}moving.
            </Copy>
            <Copy muted>
              Check in on your agents, answer a request, and pick up where you left off.
            </Copy>
          </View>
          {config.demo && (
            <Notice>
              Demo preview · All sessions and responses are simulated. No real credentials are
              needed.
            </Notice>
          )}
          {auth.error && <Notice>{auth.error}</Notice>}
          {config.developmentDaemon ? (
            <>
              <Notice>
                Live desktop connection · This opens your real workspace. Commands run on the
                connected computer. Keep Tailscale connected.
              </Notice>
              <Copy muted>{new URL(config.developmentDaemon).host}</Copy>
              <Button disabled={auth.loading} onPress={auth.connectDirect}>
                Connect to desktop
              </Button>
              <Copy muted size={13}>
                No cloud login is needed for this private test. Disconnecting leaves your desktop
                sessions running.
              </Copy>
            </>
          ) : config.demo ? (
            <Button
              disabled={auth.loading}
              onPress={() => {
                void auth.signIn("demo@concors.dev", "demo-mode");
              }}
            >
              {auth.loading ? "Getting ready…" : "Explore demo"}
            </Button>
          ) : (
            <>
              {auth.githubSignIn ? (
                <>
                  <Button
                    secondary
                    testID="github-sign-in"
                    disabled={auth.loading}
                    onPress={() => {
                      void auth.signInWithGitHub();
                    }}
                  >
                    Continue with GitHub
                  </Button>
                  <Copy muted>Or sign in with your Concors email and password.</Copy>
                </>
              ) : (
                <Copy muted>
                  Sign in with your existing Concors account to access your machines.
                </Copy>
              )}
              <Field
                label="Email"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="username"
                placeholder="you@example.com"
              />
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                onSubmitEditing={() => {
                  if (email && password && !auth.loading) void submit();
                }}
              />
              <Button
                disabled={auth.loading || !email.trim() || !password}
                onPress={() => {
                  void submit();
                }}
              >
                {auth.loading ? "Checking session…" : "Sign in"}
              </Button>
              <Copy muted size={13}>
                Your machines and agents continue running while you’re away.
              </Copy>
            </>
          )}
          {auth.error && (
            <View style={{ gap: 10 }}>
              <Button
                secondary
                onPress={() => {
                  void auth.refresh();
                }}
              >
                Retry connection
              </Button>
              <Button
                secondary
                disabled={auth.loading}
                onPress={() => {
                  void auth.signOut();
                }}
              >
                Clear saved session
              </Button>
            </View>
          )}
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Button
              secondary
              onPress={() => {
                void Linking.openURL(config.supportUrl);
              }}
            >
              Support
            </Button>
            <Button
              secondary
              onPress={() => {
                void Linking.openURL(config.privacyUrl);
              }}
            >
              Privacy
            </Button>
          </View>
        </Screen>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
