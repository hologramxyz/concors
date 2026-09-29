import type { NativeSignInChoice } from "@concors/api-client";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Button, Copy, Field, useTheme } from "../ui";

type Intent = NativeSignInChoice["intent"];

/** Loose on purpose: the API validates properly, this only catches a half-typed address. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sign in or sign up, then how: GitHub, Google or an emailed code. The in-app browser sheet opens
 * straight on that method, on the API's own page.
 */
export function SignInChoices({
  disabled,
  onChoose,
}: {
  disabled: boolean;
  onChoose(choice: NativeSignInChoice): void;
}) {
  const theme = useTheme();
  const [intent, setIntent] = useState<Intent>("sign-in");
  const [email, setEmail] = useState("");
  const address = email.trim();
  const validEmail = EMAIL_PATTERN.test(address);

  return (
    <View style={{ gap: 12 }}>
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: "row",
          padding: 3,
          borderRadius: theme.radius * 1.6,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.tint,
        }}
      >
        {(["sign-in", "sign-up"] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected: intent === option, disabled }}
            testID={option}
            disabled={disabled}
            onPress={() => setIntent(option)}
            style={{
              flex: 1,
              minHeight: 36,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: theme.radius * 1.2,
              backgroundColor: intent === option ? theme.surface : "transparent",
            }}
          >
            <Copy size={14} weight={intent === option ? "600" : "500"} muted={intent !== option}>
              {option === "sign-in" ? "Sign in" : "Sign up"}
            </Copy>
          </Pressable>
        ))}
      </View>
      <Copy muted>
        {intent === "sign-up"
          ? "Choose how you want to sign up. You'll finish in your browser."
          : "Use the method you signed up with. You'll finish in your browser."}
      </Copy>
      <Button
        secondary
        testID="sign-in-github"
        disabled={disabled}
        onPress={() => onChoose({ method: "github", intent })}
      >
        Continue with GitHub
      </Button>
      <Button
        secondary
        testID="sign-in-google"
        disabled={disabled}
        onPress={() => onChoose({ method: "google", intent })}
      >
        Continue with Google
      </Button>
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="go"
        editable={!disabled}
        onSubmitEditing={() => {
          if (validEmail && !disabled) onChoose({ method: "email", email: address, intent });
        }}
      />
      <Button
        testID="sign-in-email"
        disabled={disabled || !validEmail}
        onPress={() => onChoose({ method: "email", email: address, intent })}
      >
        Continue with email
      </Button>
    </View>
  );
}
