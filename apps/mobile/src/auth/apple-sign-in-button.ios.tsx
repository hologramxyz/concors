import { Pressable, View } from "react-native";
import { Host, Image } from "@expo/ui/swift-ui";
import { foregroundStyle } from "@expo/ui/swift-ui/modifiers";
import { Copy, useTheme } from "../ui";

/** Apple's system logo with a monochrome button, matching the other sign-in choices in size. */
export function AppleSignInButton({ disabled, onPress }: { disabled: boolean; onPress(): void }) {
  const theme = useTheme();
  const ink = theme.dark ? "#000000" : "#ffffff";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Continue with Apple"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID="sign-in-apple"
      style={({ pressed }) => ({
        minHeight: 46,
        borderRadius: 8,
        backgroundColor: theme.dark ? "#ffffff" : "#000000",
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      <View pointerEvents="none" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Host matchContents>
          <Image systemName="apple.logo" size={19} modifiers={[foregroundStyle(ink)]} />
        </Host>
        <Copy weight="600" size={16} style={{ color: ink }}>
          Continue with Apple
        </Copy>
      </View>
    </Pressable>
  );
}
