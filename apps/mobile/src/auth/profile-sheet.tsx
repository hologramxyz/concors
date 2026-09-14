import { useRef, useState } from "react";
import { ApiError, type ApiUser } from "@concors/api-client";
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Copy, Field, Notice, Screen, useTheme } from "../ui";
import { config } from "../config";
import { createDirectProfileSession } from "./direct-profile";

export function useDirectProfile() {
  const [session] = useState(() =>
    config.developmentDaemon ? createDirectProfileSession(config.developmentDaemon) : null,
  );
  const [profile, setProfile] = useState<ApiUser | null>(null);
  const [open, setOpen] = useState(false);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (email?: string, password?: string) => {
    if (!session || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      if (email !== undefined && password !== undefined) {
        await session.api.signInWithEmail({ email: email.trim(), password });
        setProfile(await session.getProfile());
        setOpen(false);
      } else {
        await session.api.signOut();
        setProfile(null);
      }
    } catch (cause) {
      session.clear();
      setProfile(null);
      setError(
        cause instanceof ApiError && [400, 401].includes(cause.status)
          ? "Email or password is incorrect."
          : "Could not verify your Concors profile. Check your connection and retry.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return {
    profile,
    openProfile: () => {
      setError(null);
      setOpen(true);
    },
    sheet: session && (
      <ProfileSheet
        open={open}
        profile={profile}
        busy={busy}
        error={error}
        onClose={() => {
          if (!busyRef.current) setOpen(false);
        }}
        onSubmit={run}
      />
    ),
  };
}

function ProfileSheet({
  open,
  profile,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  profile: ApiUser | null;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onSubmit(email?: string, password?: string): Promise<void>;
}) {
  const theme = useTheme();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#00000055" }}
      >
        <Pressable
          accessibilityLabel="Close profile"
          accessibilityRole="button"
          onPress={onClose}
          disabled={busy}
          style={{ flex: 1 }}
        />
        <SafeAreaView
          testID="profile-sheet"
          edges={["bottom"]}
          style={{
            maxHeight: "90%",
            backgroundColor: theme.background,
            borderTopLeftRadius: theme.radius * 4,
            borderTopRightRadius: theme.radius * 4,
            overflow: "hidden",
          }}
        >
          <Screen presentation="dialog" title={profile ? "Your profile" : "Sign in to Concors"}>
            {open && (
              <ProfileForm
                profile={profile}
                busy={busy}
                error={error}
                onSubmit={onSubmit}
                onClose={onClose}
              />
            )}
          </Screen>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
function ProfileForm({
  profile,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  profile: ApiUser | null;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onSubmit(email?: string, password?: string): Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submit = () => {
    const value = password;
    setPassword("");
    void onSubmit(email, value);
  };
  return (
    <View style={{ gap: 16 }}>
      {error && <Notice>{error}</Notice>}
      {profile ? (
        <>
          <Copy size={16} weight="600">
            {profile.name || profile.email}
          </Copy>
          <Copy muted>{profile.email}</Copy>
          <Button
            disabled={busy}
            onPress={() => {
              void onSubmit();
            }}
          >
            Sign out of profile
          </Button>
        </>
      ) : (
        <>
          <Copy muted>
            Use the same account as the desktop app. Your workspace stays connected while you sign
            in.
          </Copy>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="username"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            onSubmitEditing={() => {
              if (email.trim() && password && !busy) submit();
            }}
          />
          <Button disabled={busy || !email.trim() || !password} onPress={submit}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </>
      )}
      <Copy muted size={13}>
        This private preview keeps your profile session only until you close or reload it. Signing
        out of your profile does not stop desktop sessions.
      </Copy>
      <Button secondary disabled={busy} onPress={onClose}>
        Back to workspace
      </Button>
    </View>
  );
}
