import { useState, type ReactNode } from "react";
import {
  BottomSheet,
  Button,
  Divider,
  HStack,
  ScrollView,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonStyle,
  disabled,
  environment,
  font,
  foregroundStyle,
  frame,
  padding,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from "@expo/ui/swift-ui/modifiers";
import type { NativeControl } from "@concors/client-core";

/** A model picker stays presented while the WebView sends the next provider/model page. */
export function NativeControlPicker({
  label,
  options,
  dark,
  blocked,
  anchor,
  onSelect,
  onPresent,
}: {
  label: string;
  options: NonNullable<NativeControl["options"]>;
  dark: boolean;
  blocked?: boolean;
  anchor(open: () => void): ReactNode;
  onSelect?(id: string): void;
  onPresent?(open: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <BottomSheet
      isPresented={open}
      onIsPresentedChange={setOpen}
      // Restore the composer's keyboard only after the sheet's dismissal animation finishes.
      onDismiss={() => onPresent?.(false)}
      anchor={anchor(() => {
        if (blocked) return;
        onPresent?.(true);
        setOpen(true);
      })}
    >
      <VStack
        spacing={12}
        modifiers={[
          padding({ horizontal: 20, top: 24, bottom: 12 }),
          environment("colorScheme", dark ? "dark" : "light"),
          foregroundStyle(dark ? "#ededed" : "#20211f"),
          // The sheet background follows the phone unless explicitly matched to the app.
          presentationBackground(dark ? "#1f1f1f" : "#ffffff"),
          presentationDetents(["medium", "large"]),
          presentationDragIndicator("visible"),
        ]}
      >
        <HStack spacing={12}>
          <Text modifiers={[font({ size: 17, weight: "semibold" })]}>{label}</Text>
          <Spacer />
          <Button label="Cancel" onPress={() => setOpen(false)} />
        </HStack>
        <Divider />
        <ScrollView>
          <VStack alignment="leading" spacing={4}>
            {options.map((option) => (
              <Button
                key={option.id}
                label={`${option.selected ? "✓ " : ""}${option.label}`}
                onPress={() => {
                  if (blocked) return;
                  onSelect?.(option.id);
                  if (!option.navigate) setOpen(false);
                }}
                modifiers={[
                  buttonStyle("plain"),
                  disabled(!!blocked),
                  accessibilityLabel(option.label),
                  frame({ maxWidth: Infinity, minHeight: 44, alignment: "leading" }),
                  padding({ vertical: 8 }),
                ]}
              />
            ))}
          </VStack>
        </ScrollView>
      </VStack>
    </BottomSheet>
  );
}
