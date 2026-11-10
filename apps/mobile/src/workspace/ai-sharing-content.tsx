import { useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { Button, Copy, useTheme } from "../ui";
import type { AISharingDisclosure } from "./ai-sharing";

export interface AISharingDrawerProps {
  disclosure: AISharingDisclosure;
  onAnswer(allowed: boolean): void;
}

/** Keep the recipients and data visible before approval; the longer explanation is optional. */
export function AISharingContent({
  disclosure,
  onAnswer,
  disabled = false,
}: AISharingDrawerProps & { disabled?: boolean }) {
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  return (
    <View testID="ai-sharing-drawer" style={{ padding: 20, paddingTop: 28, gap: 14 }}>
      <Copy size={20} weight="600" accessibilityRole="header">
        Share with AI?
      </Copy>
      <ScrollView
        style={{ maxHeight: height * 0.5, flexGrow: 0 }}
        contentContainerStyle={{ gap: 14 }}
      >
        <Copy size={15}>{disclosure.summary}</Copy>
        {expanded && (
          <Copy size={14} muted>
            {disclosure.details}
          </Copy>
        )}
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        disabled={disabled}
        onPress={() => setExpanded((value) => !value)}
        style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}
      >
        <Copy size={14} weight="500" style={{ color: theme.muted }}>
          {expanded ? "Hide details" : "Details"}
        </Copy>
      </Pressable>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Button secondary disabled={disabled} onPress={() => onAnswer(false)}>
            Don't allow
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button disabled={disabled} onPress={() => onAnswer(true)}>
            Allow sharing
          </Button>
        </View>
      </View>
    </View>
  );
}
