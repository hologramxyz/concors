import { useState } from "react";
import { Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../ui";
import { AISharingContent, type AISharingDrawerProps } from "./ai-sharing-content";

/**
 * App Store consent, required to use agents from the phone: a full-screen modal with no close
 * button, no swipe to dismiss and no decline. Closing it by accident left people locked out, with
 * every request refused until they found the switch in Settings. Until Allow, it is shown again
 * on every launch.
 */
export function AISharingDrawer({ disclosure, onAnswer }: AISharingDrawerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [answered, setAnswered] = useState(false);
  return (
    <Modal
      testID="ai-sharing-required"
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      // Android's back button and any system dismissal: there is nothing to go back to.
      onRequestClose={() => undefined}
    >
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          backgroundColor: theme.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <AISharingContent
          disclosure={disclosure}
          disabled={answered}
          onAnswer={(allowed) => {
            if (answered) return;
            setAnswered(true);
            onAnswer(allowed);
          }}
        />
      </View>
    </Modal>
  );
}
