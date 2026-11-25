import { useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { Button, Copy, useTheme } from "../ui";
import type { AISharingDisclosure } from "./ai-sharing";

export interface AISharingDrawerProps {
  disclosure: AISharingDisclosure;
  onAnswer(allowed: boolean): void;
}

/**
 * Keep the recipients and data visible before approval; the longer explanation is optional.
 * Agents cannot work from the phone without it, so Allow is the only way on: there is nothing to
 * decline into but an app that cannot do anything (permission can be withdrawn in Settings).
 */
export function AISharingContent({
  disclosure,
  onAnswer,
  disabled = false,
}: AISharingDrawerProps & { disabled?: boolean }) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  return (
    <View
      testID="ai-sharing-drawer"
      // The native sheet sizes itself to this content, and React Native lays it out before the
      // sheet reports a width, so without one the summary stays on a single line wider than the
      // phone. An iPhone sheet spans the screen (the app does not run on iPad).
      style={{ width, padding: 20, paddingTop: 28, gap: 14 }}
    >
      <Copy size={20} weight="600" accessibilityRole="header">
        Share with AI?
      </Copy>
      <ScrollView
        style={{ maxHeight: height * 0.5, flexGrow: 0 }}
        contentContainerStyle={{ gap: 14 }}
      >
        <Copy size={15}>{disclosure.summary}</Copy>
        <Copy size={14} muted>
          Concors needs this to run agents from your iPhone.
        </Copy>
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
      <Button disabled={disabled} onPress={() => onAnswer(true)}>
        Allow sharing
      </Button>
    </View>
  );
}
