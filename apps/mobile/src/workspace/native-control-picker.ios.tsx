import { useState, type ReactNode } from "react";
import {
  BottomSheet,
  Button,
  Circle,
  HStack,
  Image,
  List,
  NavigationDestination,
  NavigationLink,
  NavigationStack,
  Section,
  Spacer,
  Text,
  Toggle,
  Toolbar,
  ToolbarItem,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  accessibilityValue,
  background,
  clipShape,
  disabled,
  font,
  frame,
  foregroundStyle,
  labelStyle,
  layoutPriority,
  lineLimit,
  listRowBackground,
  listStyle,
  navigationBarTitleDisplayMode,
  navigationTitle,
  preferredColorScheme,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  scrollContentBackground,
  tint,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";
import type { NativeControl } from "@concors/client-core";

type Option = NonNullable<NativeControl["options"]>[number];
type Page = Pick<NativeControl, "id" | "title" | "options"> & { disabled?: boolean };

/** The sidebar's dot colors: destructive for a question or failure, primary for a finish. */
const DOT = { attention: "#e5484d", done: { light: "#20211f", dark: "#ededed" } } as const;

/**
 * A workspace's mark as the sidebar draws it without a favicon: its initial on a tile, or a folder;
 * a dot on its corner when a chat in it wants a look.
 */
function RowMark({ option, dark }: { option: Option; dark: boolean }) {
  if (!option.mark) return null;
  const muted = dark ? "#a3a3a3" : "#646464";
  const dot = option.dot === "attention" ? DOT.attention : dark ? DOT.done.dark : DOT.done.light;
  return (
    <ZStack alignment="bottomTrailing" modifiers={[frame({ width: 24, height: 24 })]}>
      {option.mark === "folder" ? (
        <Image
          systemName="folder"
          size={17}
          color={muted}
          modifiers={[frame({ width: 24, height: 24 })]}
        />
      ) : (
        <Text
          modifiers={[
            font({ size: 12, weight: "semibold" }),
            frame({ width: 22, height: 22 }),
            background(dark ? "#3a3a3a" : "#dcdbd5"),
            clipShape("roundedRectangle", 5),
          ]}
        >
          {option.mark.initial}
        </Text>
      )}
      {option.dot ? (
        <Circle
          modifiers={[
            foregroundStyle(dot),
            frame({ width: 9, height: 9 }),
            background(dark ? "#292929" : "#e8e8e3"),
            clipShape("circle"),
          ]}
        />
      ) : null}
    </ZStack>
  );
}

/** Rows in the groups a list draws them in; each `section` row starts the next. */
function sections(options: readonly Option[]) {
  const groups: Option[][] = [];
  for (const option of options) {
    const group = groups.at(-1);
    if (option.section || !group) groups.push([option]);
    else group.push(option);
  }
  return groups;
}

/**
 * One of a toolbar button's sheets, in the system's own navigation stack so that its rows push pages
 * with a back chevron and an edge swipe. The sheet stays presented while the WebView answers: a
 * provider's models arrive on the first page after the provider is chosen.
 */
export function NativeControlPicker({
  control,
  pages,
  dark,
  blocked,
  anchor,
  onOpen,
  onSelect,
  onPresent,
}: {
  control: Page;
  /** The controls this sheet's rows may open. */
  pages: readonly Page[];
  dark: boolean;
  blocked?: boolean;
  anchor(open: () => void): ReactNode;
  onOpen?(): void;
  onSelect?(control: string, value: string): void;
  onPresent?(open: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<string[]>([]);
  const destinations = pages.filter((page) =>
    control.options?.some((option) => option.navigate && option.id === page.id),
  );
  const page = (shown: Page, closes: boolean) => (
    <SheetPage
      control={shown}
      pages={destinations}
      dark={dark}
      blocked={!!blocked || !!shown.disabled}
      onChoose={(option) => {
        onSelect?.(shown.id, option.id);
        if (option.toggle || option.navigate) return;
        if (closes || option.closes) setOpen(false);
        else setPath((value) => value.slice(0, -1));
      }}
    />
  );
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
        setPath([]);
        setOpen(true);
      })}
    >
      <NavigationStack
        // A page can go away beneath the stack, as Speed does for a model without tiers.
        path={path.filter((id) => destinations.some((page) => page.id === id))}
        onPathChange={setPath}
        modifiers={[
          // Also reaches the navigation bar, which the content's colorScheme does not.
          preferredColorScheme(dark ? "dark" : "light"),
          // The sheet background follows the phone unless explicitly matched to the app.
          presentationBackground(dark ? "#1f1f1f" : "#ffffff"),
          presentationDetents(["medium", "large"]),
          presentationDragIndicator("visible"),
        ]}
      >
        <Toolbar>
          {page(control, true)}
          <Toolbar.Content>
            <ToolbarItem placement="topBarLeading">
              <Button
                role="close"
                label="Close"
                systemImage="xmark"
                onPress={() => setOpen(false)}
                modifiers={[labelStyle("iconOnly")]}
              />
            </ToolbarItem>
          </Toolbar.Content>
        </Toolbar>
        {destinations.map((destination) => (
          <NavigationDestination key={destination.id} value={destination.id}>
            {page(destination, false)}
          </NavigationDestination>
        ))}
      </NavigationStack>
    </BottomSheet>
  );
}

function SheetPage({
  control,
  pages,
  dark,
  blocked,
  onChoose,
}: {
  control: Page;
  pages: readonly Page[];
  dark: boolean;
  blocked: boolean;
  onChoose(option: Option): void;
}) {
  const text = dark ? "#ededed" : "#20211f";
  const muted = dark ? "#a3a3a3" : "#646464";
  const row = [listRowBackground(dark ? "#292929" : "#e8e8e3")];
  return (
    <List
      modifiers={[
        listStyle("insetGrouped"),
        navigationTitle(control.title ?? ""),
        navigationBarTitleDisplayMode("inline"),
        foregroundStyle(text),
        // A list paints its own background over the sheet's, and a pushed page paints the stack's.
        scrollContentBackground("hidden"),
        background(dark ? "#1f1f1f" : "#ffffff"),
      ]}
    >
      {sections(control.options ?? []).map((group) => (
        <Section key={group[0]?.id}>
          {group.map((option) => {
            const off = blocked || !!option.disabled;
            if (option.toggle)
              return (
                <Toggle
                  key={option.id}
                  label={option.label}
                  isOn={option.selected}
                  onIsOnChange={() => {
                    if (!off) onChoose(option);
                  }}
                  // The host's seed color would leave a white thumb on a near-white track in dark.
                  modifiers={[...row, tint(dark ? muted : text), disabled(off)]}
                />
              );
            if (pages.some((page) => page.id === option.id))
              return (
                <NavigationLink
                  key={option.id}
                  value={option.id}
                  modifiers={[
                    ...row,
                    disabled(off),
                    accessibilityLabel(option.label),
                    accessibilityValue(option.value ?? ""),
                  ]}
                >
                  <HStack spacing={12}>
                    {/* The label keeps its width, so a long value is what truncates. */}
                    <Text modifiers={[lineLimit(1), layoutPriority(1)]}>{option.label}</Text>
                    <Spacer />
                    {option.value ? (
                      <Text
                        modifiers={[foregroundStyle(muted), lineLimit(1), truncationMode("tail")]}
                      >
                        {option.value}
                      </Text>
                    ) : null}
                  </HStack>
                </NavigationLink>
              );
            return (
              <Button
                key={option.id}
                onPress={() => {
                  if (!off) onChoose(option);
                }}
                modifiers={[
                  ...row,
                  disabled(off),
                  accessibilityLabel([option.label, option.description].filter(Boolean).join(", ")),
                  accessibilityValue(option.selected ? "Selected" : ""),
                ]}
              >
                {/* In a list the default button style takes the whole row, and would tint this. */}
                <HStack spacing={12} modifiers={[foregroundStyle(text)]}>
                  <RowMark option={option} dark={dark} />
                  <VStack alignment="leading" spacing={2}>
                    <Text>{option.label}</Text>
                    {option.description ? (
                      <Text modifiers={[font({ size: 13 }), foregroundStyle(muted)]}>
                        {option.description}
                      </Text>
                    ) : null}
                  </VStack>
                  <Spacer />
                  {option.selected ? <Image systemName="checkmark" size={15} /> : null}
                </HStack>
              </Button>
            );
          })}
        </Section>
      ))}
    </List>
  );
}
