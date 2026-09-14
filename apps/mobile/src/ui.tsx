import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import { useAppearance } from "./appearance-provider";
import { cornerRadius } from "./appearance";

const light = {
  background: "#f4f3ef",
  surface: "#ffffff",
  text: "#20211f",
  muted: "#65665f",
  border: "#d3d3cb",
  accent: "#20211f",
  onAccent: "#ffffff",
  tint: "#e8e8e3",
  selection: "#deded9",
  danger: "#a62f35",
  success: "#327344",
  warning: "#946615",
};
const dark: typeof light = {
  background: "#141414",
  surface: "#1b1b1b",
  text: "#ededed",
  muted: "#a0a0a0",
  border: "#3c3c3c",
  accent: "#ededed",
  onAccent: "#141414",
  tint: "#292929",
  selection: "#3b3b3b",
  danger: "#ff969b",
  success: "#9cce94",
  warning: "#e5c37a",
};
export function useTheme() {
  const { preferences } = useAppearance();
  const systemDark = useColorScheme() === "dark";
  const isDark = preferences.theme === "dark" || (preferences.theme === "system" && systemDark);
  return { ...(isDark ? dark : light), radius: cornerRadius(preferences.corners) };
}
export function Copy({
  children,
  muted = false,
  size = 16,
  weight = "400",
  style,
  ...props
}: {
  children?: ReactNode;
  muted?: boolean;
  size?: number;
  weight?: "400" | "500" | "600" | "700";
  style?: TextStyle;
  selectable?: boolean;
  numberOfLines?: number;
  accessibilityRole?: "header" | "text";
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Text
      {...props}
      style={[
        {
          color: muted ? theme.muted : theme.text,
          fontSize: size,
          fontWeight: weight,
          lineHeight: size * 1.45,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
export function Button({
  children,
  onPress,
  disabled = false,
  secondary = false,
  danger = false,
  testID,
}: {
  children: string;
  onPress(): void;
  disabled?: boolean;
  secondary?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          minHeight: 46,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: theme.radius * 1.6,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
          backgroundColor: secondary ? theme.tint : danger ? "#a62f35" : theme.accent,
        },
      ]}
    >
      <Copy
        weight="600"
        size={15}
        style={{ color: secondary ? theme.accent : danger ? "#ffffff" : theme.onAccent }}
      >
        {children}
      </Copy>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 7 }}>
      <Copy size={13} weight="600">
        {label}
      </Copy>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={theme.muted}
        selectionColor={Platform.OS === "ios" ? theme.accent : theme.selection}
        cursorColor={theme.accent}
        selectionHandleColor={theme.accent}
        style={[
          {
            minHeight: 48,
            borderWidth: 1,
            borderColor: theme.border,
            outlineColor: theme.accent,
            borderRadius: theme.radius * 1.6,
            paddingHorizontal: 13,
            paddingVertical: 11,
            color: theme.text,
            backgroundColor: theme.surface,
            fontSize: 16,
          },
          props.style,
        ]}
      />
    </View>
  );
}
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: theme.radius * 2.4,
          padding: 18,
          gap: 12,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="alert"
      style={{
        padding: 12,
        gap: 10,
        backgroundColor: theme.tint,
        borderRadius: theme.radius * 1.5,
      }}
    >
      {typeof children === "string" ? <Copy size={14}>{children}</Copy> : children}
    </View>
  );
}
export function Loading({ label = "Loading…" }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={{ padding: 32, alignItems: "center", gap: 12 }}>
      <ActivityIndicator color={theme.accent} />
      <Copy muted>{label}</Copy>
    </View>
  );
}
export function Screen({
  title,
  subtitle,
  children,
  action,
  scroll = true,
  presentation = "page",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  scroll?: boolean;
  presentation?: "page" | "dialog";
}) {
  const theme = useTheme();
  const content = (
    <View
      style={{
        padding: 20,
        gap: 18,
        width: "100%",
        maxWidth: 760,
        alignSelf: "center",
        ...(scroll ? {} : { flex: 1, minHeight: 0 }),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Copy size={presentation === "dialog" ? 16 : 28} weight="600" accessibilityRole="header">
            {title}
          </Copy>
          {subtitle && (
            <Copy muted size={14}>
              {subtitle}
            </Copy>
          )}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
  return (
    <SafeAreaView edges={["left", "right"]} style={{ flex: 1, backgroundColor: theme.background }}>
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}
export function Row({
  title,
  subtitle,
  badge,
  onPress,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  onPress(): void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: disabled ? 0.6 : 1,
        backgroundColor: pressed ? theme.tint : theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: theme.radius * 2,
        padding: 16,
        minHeight: 72,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      })}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Copy weight="600">{title}</Copy>
        {subtitle && (
          <Copy muted size={13} numberOfLines={2}>
            {subtitle}
          </Copy>
        )}
      </View>
      {badge && (
        <Copy size={12} style={{ color: theme.accent }}>
          {badge.replaceAll("_", " ")}
        </Copy>
      )}
      <Copy muted>›</Copy>
    </Pressable>
  );
}
export const layout = StyleSheet.create({
  stack: { gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  fill: { flex: 1, minHeight: 0 },
});
