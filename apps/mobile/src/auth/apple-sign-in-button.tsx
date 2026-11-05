import { Button } from "../ui";

/** Browser previews cannot finish native authentication; Android uses the same secure OAuth flow. */
export function AppleSignInButton({ disabled, onPress }: { disabled: boolean; onPress(): void }) {
  return (
    <Button testID="sign-in-apple" disabled={disabled} onPress={onPress}>
      Continue with Apple
    </Button>
  );
}
