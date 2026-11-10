import { useRef, useState } from "react";
import { BottomSheet, Group, Host, RNHostView } from "@expo/ui/swift-ui";
import {
  preferredColorScheme,
  presentationBackground,
  presentationDragIndicator,
} from "@expo/ui/swift-ui/modifiers";
import { useTheme } from "../ui";
import { AISharingContent, type AISharingDrawerProps } from "./ai-sharing-content";

export function AISharingDrawer({ disclosure, onAnswer }: AISharingDrawerProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(true);
  const choice = useRef<boolean | null>(null);
  const finished = useRef(false);
  return (
    <Host
      style={{ position: "absolute", width: "100%", height: 0 }}
      colorScheme={theme.dark ? "dark" : "light"}
    >
      <BottomSheet
        isPresented={open}
        onIsPresentedChange={setOpen}
        fitToContents
        onDismiss={() => {
          if (finished.current) return;
          finished.current = true;
          onAnswer(choice.current === true);
        }}
      >
        <Group
          modifiers={[
            preferredColorScheme(theme.dark ? "dark" : "light"),
            presentationBackground(theme.surface),
            presentationDragIndicator("visible"),
          ]}
        >
          <RNHostView matchContents={{ vertical: true }}>
            <AISharingContent
              disclosure={disclosure}
              disabled={!open}
              onAnswer={(allowed) => {
                if (choice.current !== null) return;
                choice.current = allowed;
                setOpen(false);
              }}
            />
          </RNHostView>
        </Group>
      </BottomSheet>
    </Host>
  );
}
