import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActionSheetIOS,
  Alert,
  Animated,
  Image as RNImage,
  Keyboard,
  PanResponder,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Button, Host, HStack, Image, RNHostView, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  background,
  buttonBorderShape,
  buttonStyle,
  clipShape,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  labelStyle,
  lineLimit,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { cornerRadius, nativeButtonShape, type CornerStyle } from "../appearance";
import type {
  NativeComposerContent,
  NativeControl,
  NativeIcon,
  NativeSurface,
  NativeSurfaceEvent,
} from "@concors/client-core";
import {
  currentNativeSnapshot,
  reconcileNativeDraft,
  type NativeChromeProps,
} from "./native-chrome-types";

const symbols = {
  menu: "line.3.horizontal",
  search: "magnifyingglass",
  files: "folder",
  back: "chevron.left",
  chevron: "chevron.down",
  plus: "plus",
  send: "arrow.up",
  stop: "stop.fill",
  model: "sparkles",
  claude: "sparkles",
  opencode: "terminal",
  pi: "function",
  brain: "brain",
  shield: "shield",
  options: "slider.horizontal.3",
  context: "circle.dotted",
  mic: "mic",
} as const;
const providerImages = {
  model: require("../../assets/codex.png"),
  claude: require("../../assets/claude.png"),
  opencode: require("../../assets/opencode.png"),
};

function useGlassAvailability() {
  // Fail closed until the accessibility settings have loaded; update while the app is running.
  const [reduceTransparency, setReduceTransparency] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then((value) => {
        if (alive) setReduceTransparency(value);
      })
      .catch(() => undefined);
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduceMotion(value);
      })
      .catch(() => undefined);
    const transparency = AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      setReduceTransparency,
    );
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      alive = false;
      transparency.remove();
      motion.remove();
    };
  }, []);
  return {
    glass: !reduceTransparency && isGlassEffectAPIAvailable() && isLiquidGlassAvailable(),
    reduceMotion,
  };
}

export function NativeChrome({ host, snapshot, send }: NativeChromeProps) {
  const availability = useGlassAvailability();
  const [size, setSize] = useState({ width: 0, height: 0 });
  if (!host || !snapshot || !currentNativeSnapshot(host, snapshot)) return null;
  const dark =
    host.preferences.theme === "dark" || (host.preferences.theme === "system" && host.systemDark);
  return (
    <View
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      onLayout={(event) => setSize(event.nativeEvent.layout)}
    >
      {snapshot.surfaces.map((surface) => {
        const scale = size.width ? size.width / snapshot.viewport.width : 1;
        const top =
          surface.content.kind === "composer" && size.height
            ? size.height - (snapshot.viewport.height - surface.frame.y)
            : surface.frame.y;
        const emit = (event: NativeSurfaceEvent) =>
          send({
            type: "native-event",
            scope: snapshot.scope,
            connectionId: snapshot.connectionId,
            surfaceId: surface.id,
            event,
          });
        return (
          <View
            key={surface.id}
            style={{
              position: "absolute",
              left: surface.frame.x * scale,
              top,
              width: surface.frame.width * scale,
              height: surface.frame.height,
            }}
          >
            {surface.content.kind === "button" ? (
              <HeaderButton
                content={surface.content}
                width={surface.frame.width * scale}
                height={surface.frame.height}
                corners={host.preferences.corners}
                dark={dark}
                glass={availability.glass}
                emit={emit}
              />
            ) : (
              <Composer
                content={surface.content}
                corners={host.preferences.corners}
                dark={dark}
                {...availability}
                emit={emit}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

type Emit = (event: NativeSurfaceEvent) => void;
function HeaderButton({
  content,
  width,
  height,
  corners,
  dark,
  glass,
  emit,
}: {
  content: Extract<NativeSurface["content"], { kind: "button" }>;
  width: number;
  height: number;
  corners: CornerStyle;
  dark: boolean;
  glass: boolean;
  emit: Emit;
}) {
  const latest = useRef(emit);
  const suppressPressUntil = useRef(0);
  useEffect(() => {
    latest.current = emit;
  });
  const pan = useMemo(
    () =>
      // PanResponder stores these handlers; it does not read the latest-event ref during render.
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          Math.abs(gesture.dx) > 20 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderGrant: () => {
          suppressPressUntil.current = Infinity;
        },
        onPanResponderRelease: (_, gesture) => {
          // Deferred native gesture callback, not evaluated while constructing PanResponder.
          // eslint-disable-next-line react-hooks/purity
          suppressPressUntil.current = Date.now() + 350;
          if (Math.abs(gesture.dx) > 60)
            latest.current({ kind: "swipe", direction: gesture.dx > 0 ? "right" : "left" });
        },
        onPanResponderTerminate: () => {
          // eslint-disable-next-line react-hooks/purity
          suppressPressUntil.current = Date.now() + 350;
        },
      }),
    [],
  );
  const pill = !!content.title;
  const [shape, radius] = nativeButtonShape(corners, pill);
  return (
    <View
      style={styles.fill}
      {...pan.panHandlers}
      onTouchStart={() => {
        suppressPressUntil.current = 0;
      }}
    >
      <Host
        style={styles.fill}
        colorScheme={dark ? "dark" : "light"}
        seedColor={dark ? "#eeeeee" : "#222222"}
        ignoreSafeArea="all"
      >
        <Button
          testID={`native-header-${content.icon}`}
          onPress={() => {
            if (Date.now() < suppressPressUntil.current) return;
            Keyboard.dismiss();
            emit({ kind: "press", control: "activate" });
          }}
          modifiers={[
            // Styled SwiftUI buttons add their own padding around custom labels.
            // Size the native button once, then apply real SwiftUI glass to that frame.
            buttonStyle("plain"),
            frame({ width, height }),
            ...(glass
              ? [
                  glassEffect({
                    shape,
                    cornerRadius: radius,
                    glass: { variant: "regular", interactive: true },
                  }),
                ]
              : [background(dark ? "#292929" : "#e8e8e3"), clipShape(shape, radius)]),
            disabled(content.disabled),
            accessibilityLabel(
              [content.label, content.title, content.subtitle].filter(Boolean).join(", "),
            ),
          ]}
        >
          {pill ? (
            <HStack
              spacing={8}
              modifiers={[padding({ horizontal: 12 }), frame({ maxWidth: Infinity })]}
            >
              <VStack
                alignment="leading"
                spacing={1}
                modifiers={[frame({ maxWidth: Infinity, alignment: "leading" })]}
              >
                <Text modifiers={[font({ size: 13, weight: "semibold" }), lineLimit(1)]}>
                  {content.title}
                </Text>
                {content.subtitle ? (
                  <Text
                    modifiers={[
                      font({ size: 11 }),
                      foregroundStyle(dark ? "#c0c0c0" : "#646464"),
                      lineLimit(1),
                    ]}
                  >
                    {content.subtitle}
                  </Text>
                ) : null}
              </VStack>
              <Image systemName={symbols[content.icon]} size={14} />
            </HStack>
          ) : (
            <Image
              systemName={symbols[content.icon]}
              size={20}
              modifiers={[frame({ width: 20, height: 20 })]}
            />
          )}
        </Button>
      </Host>
    </View>
  );
}

function Control({
  icon,
  corners,
  label,
  dark,
  primary,
  blocked,
  onPress,
  options,
  onSelect,
  onPresent,
  width = 40,
}: {
  icon: NativeIcon;
  corners: CornerStyle;
  label: string;
  dark: boolean;
  primary?: boolean;
  blocked?: boolean;
  onPress?(): void;
  options?: NativeControl["options"];
  onSelect?(id: string): void;
  onPresent?(open: boolean): void;
  width?: number;
}) {
  const modifiers = [
    buttonStyle(primary ? "borderedProminent" : "plain"),
    ...(primary ? [foregroundStyle(dark ? "#141414" : "#ffffff")] : []),
    buttonBorderShape(...nativeButtonShape(corners)),
    controlSize("regular"),
    disabled(!!blocked),
    accessibilityLabel(label),
    frame({ width, height: 44 }),
  ];
  return (
    <Host
      style={[styles.control, { width }]}
      colorScheme={dark ? "dark" : "light"}
      seedColor={dark ? "#ededed" : "#20211f"}
      ignoreSafeArea="all"
    >
      {options ? (
        <Button
          testID={`native-composer-${icon}`}
          onPress={() => {
            onPresent?.(true);
            ActionSheetIOS.showActionSheetWithOptions(
              {
                title: label,
                options: [
                  ...options.map((option) => `${option.selected ? "✓ " : ""}${option.label}`),
                  "Cancel",
                ],
                cancelButtonIndex: options.length,
                tintColor: dark ? "#ededed" : "#20211f",
                cancelButtonTintColor: dark ? "#ededed" : "#20211f",
                userInterfaceStyle: dark ? "dark" : "light",
              },
              (index) => {
                if (options[index]) onSelect?.(options[index].id);
                onPresent?.(false);
              },
            );
          }}
          modifiers={modifiers}
        >
          {icon === "model" || icon === "claude" || icon === "opencode" ? (
            <RNHostView matchContents>
              <RNImage
                source={providerImages[icon]}
                style={{ width: 18, height: 18, tintColor: dark ? "#eee" : "#222" }}
              />
            </RNHostView>
          ) : icon === "pi" ? (
            <Text modifiers={[font({ size: 20 })]}>π</Text>
          ) : (
            <Image systemName={symbols[icon]} size={18} />
          )}
        </Button>
      ) : (
        <Button
          testID={`native-composer-${icon}`}
          label={label}
          systemImage={symbols[icon]}
          onPress={onPress}
          modifiers={[...modifiers, labelStyle("iconOnly")]}
        />
      )}
    </Host>
  );
}

function Composer({
  content,
  corners,
  dark,
  glass,
  reduceMotion,
  emit,
}: {
  content: NativeComposerContent;
  corners: CornerStyle;
  dark: boolean;
  glass: boolean;
  reduceMotion: boolean;
  emit: Emit;
}) {
  const input = useRef<TextInput>(null);
  const sequence = useRef(content.editAck);
  const [draft, setDraft] = useState(content.draft);
  const [focused, setFocused] = useState(false);
  const [textHeight, setTextHeight] = useState(40);
  const [picking, setPicking] = useState(false);
  const [width, setWidth] = useState(360);
  const presenting = useRef(false);
  const alive = useRef(true);
  const latest = useRef({ content, emit });
  useEffect(() => {
    latest.current = { content, emit };
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setDraft((value) =>
      reconcileNativeDraft(value, sequence.current, content.draft, content.editAck),
    );
  }, [content.draft, content.editAck]);
  const expanded = focused;
  const height = expanded ? Math.min(208, Math.max(112, textHeight + 64)) : 56;
  const [motion] = useState(() => new Animated.Value(height));
  useEffect(() => {
    latest.current.emit({ kind: "height", height });
    const animation = Animated.timing(motion, {
      toValue: height,
      duration: reduceMotion ? 0 : 220,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [height, motion, reduceMotion]);
  useEffect(() => {
    const listener = Keyboard.addListener("keyboardDidHide", () => {
      if (presenting.current) return;
      input.current?.blur();
      setFocused(false);
      latest.current.emit({ kind: "focus", focused: false });
    });
    return () => {
      listener.remove();
    };
  }, []);
  const onPresent = (open: boolean) => {
    presenting.current = open;
    if (!open && alive.current) {
      input.current?.focus();
    }
  };
  const attach = async () => {
    if (!content.attachEnabled || picking) return;
    setPicking(true);
    onPresent(true);
    const copies: File[] = [];
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      for (const asset of result.assets) {
        // Only remove DocumentPicker-owned cached copies, never the user's source documents.
        if (asset.uri.startsWith(Paths.cache.uri)) copies.push(new File(asset.uri));
      }
      if (!alive.current) return;
      if (result.assets.length > 3) throw new Error("Attach up to three files per message.");
      const attachments = [];
      for (const asset of result.assets) {
        const file = new File(asset.uri);
        if (!asset.name || asset.name.length > 200)
          throw new Error("The attachment name is too long.");
        if (file.size > 1024 * 1024 || (asset.size ?? 0) > 1024 * 1024)
          throw new Error(`${asset.name} is larger than 1 MB.`);
        attachments.push({
          name: asset.name,
          mime: asset.mimeType ?? "application/octet-stream",
          data: await file.base64(),
        });
      }
      if (alive.current && latest.current.content.attachEnabled)
        latest.current.emit({ kind: "attachments", attachments });
    } catch (error) {
      if (alive.current)
        Alert.alert(
          "Could not attach files",
          error instanceof Error ? error.message : "Please try again.",
        );
    } finally {
      for (const file of copies) {
        try {
          if (file.exists) file.delete();
        } catch {
          /* The OS also clears its temporary cache. */
        }
      }
      onPresent(false);
      if (alive.current) setPicking(false);
    }
  };
  const stop = content.active && !draft.trim() && !content.hasAttachments;
  const controlWidth = Math.min(40, (width - 12) / 8);
  const glassShape = { borderRadius: cornerRadius(corners) * 3.6 };
  const sendButton = (
    <Control
      icon={stop ? "stop" : "send"}
      corners={corners}
      label={stop ? "Interrupt agent" : content.active ? "Queue message" : "Send message"}
      dark={dark}
      width={controlWidth}
      primary
      blocked={
        stop ? !content.canStop : !content.canSend || (!draft.trim() && !content.hasAttachments)
      }
      onPress={() => emit({ kind: "press", control: stop ? "stop" : "send", text: draft })}
    />
  );
  const attachButton = (
    <Control
      icon="plus"
      corners={corners}
      label="Attach files"
      dark={dark}
      width={controlWidth}
      blocked={!content.attachEnabled || picking}
      onPress={() => void attach()}
    />
  );
  const surface = (
    <View
      style={[styles.composer, !expanded && styles.collapsed]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {!expanded && attachButton}
      <TextInput
        testID="native-agent-input"
        ref={input}
        accessibilityLabel="Message your agent"
        placeholder={content.placeholder}
        placeholderTextColor={dark ? "#a3a3a3" : "#666"}
        selectionColor={dark ? "#ededed" : "#20211f"}
        value={draft}
        editable={content.editable}
        multiline
        maxLength={16000}
        scrollEnabled={expanded}
        textAlignVertical="top"
        style={[
          styles.input,
          { color: dark ? "#f5f5f5" : "#20211f" },
          expanded ? { height: height - 60 } : styles.collapsedInput,
        ]}
        onContentSizeChange={(event) => setTextHeight(event.nativeEvent.contentSize.height)}
        onChangeText={(text) => {
          setDraft(text);
          emit({ kind: "text", text, sequence: ++sequence.current });
        }}
        onFocus={() => {
          setFocused(true);
          emit({ kind: "focus", focused: true });
        }}
        onBlur={() => {
          if (presenting.current) return;
          setFocused(false);
          emit({ kind: "focus", focused: false });
        }}
      />
      {expanded ? (
        <View style={styles.toolbar}>
          {attachButton}
          {content.controls.map((control) => (
            <Control
              key={control.id}
              {...control}
              corners={corners}
              dark={dark}
              width={controlWidth}
              onPresent={onPresent}
              blocked={control.disabled}
              onSelect={(value) => emit({ kind: "press", control: control.id, value })}
            />
          ))}
          <View style={styles.spacer} />
          <Control
            icon="context"
            corners={corners}
            label="Context window"
            dark={dark}
            width={controlWidth}
            onPress={() => {
              onPresent(true);
              Alert.alert("Context window", content.context, [
                { text: "OK", onPress: () => onPresent(false) },
              ]);
            }}
          />
          <Control
            icon="mic"
            corners={corners}
            label="Start dictation"
            dark={dark}
            width={controlWidth}
            blocked={!content.editable}
            onPress={() => {
              onPresent(true);
              Alert.alert(
                "Keyboard dictation",
                "Use the microphone on your iPhone keyboard to dictate. Review your message before sending.",
                [{ text: "OK", onPress: () => onPresent(false) }],
              );
            }}
          />
          {sendButton}
        </View>
      ) : (
        sendButton
      )}
    </View>
  );
  return (
    <Animated.View style={[styles.composerFrame, { height: motion }]}>
      {glass ? (
        <GlassView
          testID="native-liquid-glass-composer"
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, glassShape]}
          glassEffectStyle="regular"
          colorScheme={dark ? "dark" : "light"}
        />
      ) : (
        <View
          style={[
            StyleSheet.absoluteFill,
            glassShape,
            {
              backgroundColor: dark ? "#242424" : "#faf9f5",
              borderColor: dark ? "#494949" : "#d2d1cc",
              borderWidth: 1,
            },
          ]}
          pointerEvents="none"
        />
      )}
      {surface}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  control: { width: 40, height: 44, flexShrink: 1 },
  composerFrame: { position: "absolute", bottom: 0, left: 0, right: 0 },
  composer: { flex: 1, padding: 6 },
  collapsed: { flexDirection: "row", alignItems: "center" },
  input: { fontSize: 15, lineHeight: 21, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 },
  collapsedInput: { flex: 1, height: 42, paddingHorizontal: 4, paddingTop: 9 },
  toolbar: { flexDirection: "row", alignItems: "center", height: 44 },
  spacer: { flex: 1 },
});
