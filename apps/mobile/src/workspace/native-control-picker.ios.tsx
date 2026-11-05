import { Fragment, useState, type ReactNode } from "react";
import {
  BottomSheet,
  Button,
  Divider,
  HStack,
  Image,
  ScrollView,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  accessibilityValue,
  buttonStyle,
  contentShape,
  disabled,
  environment,
  font,
  foregroundStyle,
  frame,
  padding,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import type { NativeControl } from "@concors/client-core";

/** A model picker stays presented while the WebView sends the next provider/model page. */
export function NativeControlPicker({
  label,
  options,
  dark,
  blocked,
  anchor,
  onOpen,
  onSelect,
  onPresent,
}: {
  label: string;
  options: NonNullable<NativeControl["options"]>;
  dark: boolean;
  blocked?: boolean;
  anchor(open: () => void): ReactNode;
  onOpen?(): void;
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
        onOpen?.();
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
              <Fragment key={option.id}>
                {option.divider ? <Divider /> : null}
                <Button
                  onPress={() => {
                    if (blocked || option.disabled) return;
                    onSelect?.(option.id);
                    if (!option.navigate) setOpen(false);
                  }}
                  modifiers={[
                    buttonStyle("plain"),
                    disabled(!!blocked || !!option.disabled),
                    accessibilityLabel(
                      [option.label, option.description].filter(Boolean).join(", "),
                    ),
                    accessibilityValue(option.selected ? "Selected" : ""),
                  ]}
                >
                  {/* Plain buttons hit-test their label, so the label fills the whole row. */}
                  <HStack
                    spacing={12}
                    modifiers={[
                      frame({ maxWidth: Infinity, minHeight: 44, alignment: "leading" }),
                      padding({ vertical: 4 }),
                      contentShape(shapes.rectangle()),
                    ]}
                  >
                    <VStack alignment="leading" spacing={2}>
                      <Text>{option.label}</Text>
                      {option.description ? (
                        <Text
                          modifiers={[
                            font({ size: 13 }),
                            foregroundStyle(dark ? "#a3a3a3" : "#646464"),
                          ]}
                        >
                          {option.description}
                        </Text>
                      ) : null}
                    </VStack>
                    <Spacer />
                    {option.selected ? <Image systemName="checkmark" size={15} /> : null}
                  </HStack>
                </Button>
              </Fragment>
            ))}
          </VStack>
        </ScrollView>
      </VStack>
    </BottomSheet>
  );
}
