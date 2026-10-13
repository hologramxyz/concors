import type { NativeSignInChoice } from "@concors/api-client";
import { useState } from "react";
import { View } from "react-native";
import { Button, Copy, Field } from "../ui";

/** Loose on purpose: the API validates properly, this only catches a half-typed address. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * How to continue: GitHub, Google or an emailed code. Signing in and signing up are one step. The
 * in-app browser sheet opens straight on that method, on the API's own page.
 */
export function SignInChoices({
  disabled,
  onChoose,
}: {
  disabled: boolean;
  onChoose(choice: NativeSignInChoice): void;
}) {
  const [email, setEmail] = useState("");
  const address = email.trim();
  const validEmail = EMAIL_PATTERN.test(address);

  return (
    <View style={{ gap: 12 }}>
      <Copy muted>
        {
          "Use the account you signed up with. If you're new, this creates one. You'll finish in your browser."
        }
      </Copy>
      <Button
        secondary
        testID="sign-in-github"
        disabled={disabled}
        onPress={() => onChoose({ method: "github" })}
      >
        Continue with GitHub
      </Button>
      <Button
        secondary
        testID="sign-in-google"
        disabled={disabled}
        onPress={() => onChoose({ method: "google" })}
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
          if (validEmail && !disabled) onChoose({ method: "email", email: address });
        }}
      />
      <Button
        testID="sign-in-email"
        disabled={disabled || !validEmail}
        onPress={() => onChoose({ method: "email", email: address })}
      >
        Continue with email
      </Button>
    </View>
  );
}
