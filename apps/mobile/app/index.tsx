import { Redirect } from "expo-router";
import { Image, Linking, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../src/auth/provider";
import { config } from "../src/config";
import { Button, Copy, Notice, Screen, useTheme } from "../src/ui";
import { useAppearance } from "../src/appearance-provider";
import { StartupScreen } from "../src/startup";

export default function SignInScreen() {
  const auth = useAuth();
  const theme = useTheme();
  const { ready } = useAppearance();
  if (!ready || auth.initializing) return <StartupScreen />;
  if (auth.me || auth.direct) return <Redirect href="/(app)" />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
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
            Demo preview · All sessions and responses are simulated. No real credentials are needed.
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
              void auth.exploreDemo();
            }}
          >
            {auth.loading ? "Getting ready…" : "Explore demo"}
          </Button>
        ) : !auth.signInSupported ? (
          <Copy muted>
            Signing in needs the Concors app for iOS or Android; this browser preview cannot finish
            it.
          </Copy>
        ) : (
          <>
            <Copy muted>Continue in your browser with GitHub, Google or email.</Copy>
            {auth.signInChecking && <Copy muted>Checking sign-in options…</Copy>}
            {auth.signInCheckError && (
              <>
                <Notice>{auth.signInCheckError}</Notice>
                <Button
                  secondary
                  testID="retry-sign-in"
                  disabled={auth.signInChecking}
                  onPress={() => {
                    void auth.retrySignInCheck();
                  }}
                >
                  Retry
                </Button>
              </>
            )}
            {auth.signInAvailable ? (
              <Button
                testID="sign-in"
                disabled={auth.loading}
                onPress={() => {
                  void auth.signIn();
                }}
              >
                {auth.loading ? "Checking session…" : "Sign in"}
              </Button>
            ) : (
              !auth.signInChecking &&
              !auth.signInCheckError && (
                <Copy muted>Sign-in is not set up on this Concors server yet.</Copy>
              )
            )}
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
    </SafeAreaView>
  );
}
