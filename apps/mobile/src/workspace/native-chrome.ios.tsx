import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
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
import {
  BottomSheet,
  Button,
  Divider,
  Host,
  HStack,
  Image,
  ProgressView,
  RNHostView,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  accessibilityValue,
  Animation,
  animation,
  background,
  buttonStyle,
  clipShape,
  contentShape,
  disabled,
  environment,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  labelStyle,
  lineLimit,
  monospacedDigit,
  opacity,
  padding,
  presentationBackground,
  presentationDragIndicator,
  progressViewStyle,
  rotationEffect,
  shapes,
  strokeBorder,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { File, Paths } from "expo-file-system";
import { MAX_UPLOAD_BYTES } from "@concors/protocol";
import { cornerRadius, nativeButtonShape, type CornerStyle } from "../appearance";
import type {
  NativeComposerContent,
  NativeControl,
  NativeIcon,
  NativeSurface,
  NativeSurfaceEvent,
  NativeUsage,
} from "@concors/client-core";
import {
  contextRingStroke,
  contextRingValue,
  currentNativeSnapshot,
  nativeSurfaceLayout,
  reconcileNativeDraft,
  type NativeChromeProps,
} from "./native-chrome-types";
import { NativeControlPicker } from "./native-control-picker.ios";

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
  mic: "mic",
  machine: "server.rack",
  account: "person.crop.circle",
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
        const layout = nativeSurfaceLayout(surface, snapshot.viewport, size);
        const interactive = surface.interactive !== false;
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
            // The clip reaches past the control for its shadow; only the control takes touches.
            pointerEvents={interactive ? "box-none" : "none"}
            accessibilityElementsHidden={!interactive}
            style={{
              position: "absolute",
              overflow: "hidden",
              ...layout.clip,
            }}
          >
            <View style={{ position: "absolute", ...layout.content }}>
              {surface.content.kind === "button" ? (
                <HeaderButton
                  content={surface.content}
                  width={layout.content.width}
                  height={layout.content.height}
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
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
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
  const anchor = (press: () => void) => (
    <Button
      testID={`native-header-${content.icon}`}
      onPress={() => {
        if (Date.now() < suppressPressUntil.current) return;
        Keyboard.dismiss();
        press();
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
          modifiers={[
            padding({ horizontal: 12 }),
            ...(["chevron", "machine", "account"].includes(content.icon)
              ? [
                  // Plain buttons hit-test their label, not the outer glass frame.
                  frame({ width, height }),
                  contentShape(shapes.rectangle()),
                ]
              : [frame({ maxWidth: Infinity })]),
          ]}
        >
          {(content.icon === "machine" || content.icon === "account") &&
            (content.icon === "account" &&
            content.avatarUrl &&
            failedAvatar !== content.avatarUrl ? (
              <RNHostView matchContents>
                <RNImage
                  source={{ uri: content.avatarUrl }}
                  onError={() => setFailedAvatar(content.avatarUrl ?? null)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: corners === "rounded" ? 14 : cornerRadius(corners),
                  }}
                />
              </RNHostView>
            ) : content.mark ? (
              <Text
                modifiers={[
                  font({ size: content.icon === "account" ? 13 : 18, weight: "semibold" }),
                  ...(content.icon === "account"
                    ? [
                        frame({ width: 28, height: 28 }),
                        foregroundStyle(dark ? "#141414" : "#ffffff"),
                        background(dark ? "#ededed" : "#20211f"),
                        clipShape(...nativeButtonShape(corners)),
                      ]
                    : []),
                ]}
              >
                {content.mark}
              </Text>
            ) : (
              <Image systemName={symbols[content.icon]} size={20} />
            ))}
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
          <Image
            systemName={
              content.icon === "machine" || content.icon === "account"
                ? "chevron.down"
                : symbols[content.icon]
            }
            size={14}
          />
        </HStack>
      ) : (
        <Image
          systemName={symbols[content.icon]}
          size={20}
          modifiers={[frame({ width: 20, height: 20 })]}
        />
      )}
    </Button>
  );
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
        {content.menu ? (
          // The workspace switcher, in the grouped sheet the composer's controls use; the WebView
          // gets each choice as a press of the menu with the row's ID.
          <NativeControlPicker
            control={{
              id: content.menu.id,
              title: content.menu.title,
              options: content.menu.options,
            }}
            pages={[]}
            dark={dark}
            anchor={anchor}
            onSelect={(control, value) => emit({ kind: "press", control, value })}
          />
        ) : (
          anchor(() => emit({ kind: "press", control: "activate" }))
        )}
      </Host>
    </View>
  );
}

function controlModifiers({
  label,
  blocked,
  color,
}: {
  label: string;
  blocked?: boolean;
  color?: string | null;
}) {
  return [
    buttonStyle("plain"),
    ...(color ? [foregroundStyle(color)] : []),
    disabled(!!blocked),
    accessibilityLabel(label),
  ];
}

/** Plain buttons hit-test their label, so the label is what fills the 44pt control. */
function ControlFace({
  corners,
  dark,
  primary,
  blocked,
  children,
}: {
  corners: CornerStyle;
  dark: boolean;
  primary?: boolean;
  blocked?: boolean;
  children: ReactElement;
}) {
  return (
    <HStack
      modifiers={[
        frame({ width: 44, height: 44 }),
        ...(primary
          ? [
              foregroundStyle(dark ? "#141414" : "#ffffff"),
              background(dark ? "#ededed" : "#20211f"),
              clipShape(...nativeButtonShape(corners)),
              opacity(blocked ? 0.3 : 1),
            ]
          : []),
        contentShape(shapes.rectangle()),
      ]}
    >
      {children}
    </HStack>
  );
}

function Control({
  id,
  icon,
  corners,
  label,
  title,
  dark,
  primary,
  blocked,
  onPress,
  options,
  pages,
  onSelect,
  onPresent,
}: {
  id?: string;
  icon: NativeIcon;
  corners: CornerStyle;
  label: string;
  title?: string | undefined;
  dark: boolean;
  primary?: boolean;
  blocked?: boolean;
  /** For a control with options, also runs as its sheet opens. */
  onPress?(): void;
  options?: NativeControl["options"];
  /** The controls its sheet's rows can open as pages. */
  pages?: readonly NativeControl[];
  onSelect?(control: string, value: string): void;
  onPresent?(open: boolean): void;
}) {
  const modifiers = controlModifiers({ label, blocked });
  const button = (press: (() => void) | undefined) => (
    <Button testID={`native-composer-${icon}`} onPress={press} modifiers={modifiers}>
      <ControlFace corners={corners} dark={dark} primary={primary} blocked={blocked}>
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
      </ControlFace>
    </Button>
  );
  return (
    <Host
      style={styles.control}
      colorScheme={dark ? "dark" : "light"}
      seedColor={dark ? "#ededed" : "#20211f"}
      ignoreSafeArea="all"
    >
      {id && options ? (
        <NativeControlPicker
          control={{ id, title: title ?? label, options }}
          pages={pages ?? []}
          dark={dark}
          blocked={blocked}
          anchor={button}
          onOpen={onPress}
          onSelect={onSelect}
          onPresent={onPresent}
        />
      ) : (
        button(onPress)
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
  // Send keeps an even 8pt to the right and bottom edges, as on the phone web build. Liquid Glass
  // draws its edge 3pt inside its frame, so 8pt there takes 11pt of padding.
  const inset = glass ? 11 : 8;
  const toolbarHeight = 44 + inset * 2;
  const height = expanded
    ? Math.min(208 + inset, Math.max(112 + inset, textHeight + 64 + inset))
    : toolbarHeight;
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
  // Like Messages and Paseo: photos and videos first, any file from Files second.
  const chooseSource = async () => {
    // A text field offers no Paste for an image, so the sheet does while the clipboard holds one.
    // Asking whether it does shows no "pasted from" notice; only reading it does.
    const sources = [
      ...((await Clipboard.hasImageAsync().catch(() => false)) ? (["clipboard"] as const) : []),
      "photos" as const,
      "files" as const,
    ];
    const labels = { clipboard: "Paste Image", photos: "Photo Library", files: "Choose File" };
    return new Promise<(typeof sources)[number] | null>((resolve) =>
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...sources.map((source) => labels[source]), "Cancel"],
          cancelButtonIndex: sources.length,
        },
        (index) => resolve(sources[index] ?? null),
      ),
    );
  };
  const pick = async (source: "clipboard" | "photos" | "files") => {
    if (source === "clipboard") {
      const image = await Clipboard.getImageAsync({ format: "png" });
      const base64 = image?.data.split(",", 2)[1];
      if (!base64) return null;
      // Into the cache like the pickers' copies, so it is checked, sent and removed as they are.
      const file = new File(Paths.cache, `pasted-${Date.now()}.png`);
      file.create();
      file.write(base64, { encoding: "base64" });
      return [{ uri: file.uri, name: "Pasted image.png", mime: "image/png", size: file.size }];
    }
    if (source === "files") {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });
      return result.canceled
        ? null
        : result.assets.map((asset) => ({
            uri: asset.uri,
            name: asset.name,
            mime: asset.mimeType,
            size: asset.size,
          }));
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      // Agents read JPEG, not the HEIC an iPhone takes photos in.
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    return result.canceled
      ? null
      : result.assets.map((asset, index) => {
          const mime = asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg");
          const name =
            asset.fileName ?? `${asset.type === "video" ? "Video" : "Photo"} ${index + 1}`;
          return {
            uri: asset.uri,
            name: mime === "image/jpeg" ? name.replace(/\.hei[cf]$/i, ".jpg") : name,
            mime,
            size: asset.fileSize,
          };
        });
  };
  const attach = async () => {
    if (!content.attachEnabled || picking) return;
    setPicking(true);
    onPresent(true);
    const copies: File[] = [];
    try {
      const source = await chooseSource();
      const assets = source && (await pick(source));
      if (!assets) return;
      for (const asset of assets) {
        // Only remove the pickers' cached copies, never the user's source documents.
        if (asset.uri.startsWith(Paths.cache.uri)) copies.push(new File(asset.uri));
      }
      if (!alive.current) return;
      // A machine that takes uploads has no count limit; the composer uploads each file.
      const uploads = !!content.uploads;
      if (!uploads && assets.length > 3)
        throw new Error(
          "Attach up to three files per message. This machine needs a Concors update to attach more.",
        );
      const limit = uploads ? MAX_UPLOAD_BYTES : 1024 * 1024;
      const attachments = [];
      const refused: string[] = [];
      for (const asset of assets) {
        const file = new File(asset.uri);
        if (!asset.name || asset.name.length > 200)
          throw new Error("The attachment name is too long.");
        if (file.size > limit || (asset.size ?? 0) > limit) {
          if (!uploads)
            throw new Error(
              `${asset.name} is larger than 1 MB. This machine needs a Concors update to attach larger files.`,
            );
          refused.push(`${asset.name} is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
          continue;
        }
        const attachment = {
          name: asset.name,
          mime: asset.mime ?? "application/octet-stream",
          data: await file.base64(),
        };
        // One file per event, so a large one is never part of an even larger message.
        if (!uploads) attachments.push(attachment);
        else if (alive.current && latest.current.content.attachEnabled)
          latest.current.emit({ kind: "attachments", attachments: [attachment] });
      }
      if (attachments.length && alive.current && latest.current.content.attachEnabled)
        latest.current.emit({ kind: "attachments", attachments });
      if (refused.length) throw new Error(refused.join("\n"));
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
  const glassShape = { borderRadius: cornerRadius(corners) * 3.6 };
  const sendButton = (
    <Control
      icon={stop ? "stop" : "send"}
      corners={corners}
      label={stop ? "Interrupt agent" : content.active ? "Queue message" : "Send message"}
      dark={dark}
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
      blocked={!content.attachEnabled || picking}
      onPress={() => void attach()}
    />
  );
  const surface = (
    <View style={[styles.composer, { padding: inset }, !expanded && styles.collapsed]}>
      {!expanded && attachButton}
      <TextInput
        testID="native-agent-input"
        ref={input}
        accessibilityLabel={content.placeholder}
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
          expanded ? { height: height - toolbarHeight } : styles.collapsedInput,
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
          {content.controls
            .filter((control) => control.id === "model" || control.id === "options")
            .map((control) => (
              <Control
                key={control.id}
                {...control}
                corners={corners}
                dark={dark}
                onPresent={onPresent}
                blocked={control.disabled}
                pages={content.controls}
                onPress={
                  control.id === "model"
                    ? () => emit({ kind: "press", control: "model-open" })
                    : undefined
                }
                onSelect={(from, value) => emit({ kind: "press", control: from, value })}
              />
            ))}
          <View style={styles.spacer} />
          {content.usage ? (
            <ContextControl
              usage={content.usage}
              corners={corners}
              dark={dark}
              reduceMotion={reduceMotion}
              emit={emit}
              onPresent={onPresent}
            />
          ) : null}
          <Control
            icon="mic"
            corners={corners}
            label="Start dictation"
            dark={dark}
            blocked={!content.editable}
            onPress={() => {
              if (!content.dictationHelp) {
                emit({ kind: "press", control: "dictate", text: draft });
                return;
              }
              onPresent(true);
              Alert.alert("Dictation", content.dictationHelp, [
                { text: "OK", onPress: () => onPresent(false) },
              ]);
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

const toneColors = {
  light: { warning: "#fe9a00", danger: "#de3b3d" },
  dark: { warning: "#fe9a00", danger: "#f75d59" },
} as const;
// The desktop ring's amber and destructive red; an ordinary share keeps the control's own color.
function toneColor(tone: NativeUsage["context"]["tone"], dark: boolean) {
  return tone === "warning" || tone === "danger" ? toneColors[dark ? "dark" : "light"][tone] : null;
}

/**
 * The composer's context button and the sheet behind it: this conversation's context window, and
 * what is left of the plan the provider bills. Opening the sheet is what asks for plan usage,
 * as opening the desktop popover does, and the sheet follows the answer while it is open.
 */
function ContextControl({
  usage,
  corners,
  dark,
  reduceMotion,
  emit,
  onPresent,
}: {
  usage: NativeUsage;
  corners: CornerStyle;
  dark: boolean;
  reduceMotion: boolean;
  emit: Emit;
  onPresent(open: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  const { percent } = usage.context;
  return (
    <Host
      style={styles.control}
      colorScheme={dark ? "dark" : "light"}
      seedColor={dark ? "#ededed" : "#20211f"}
      ignoreSafeArea="all"
    >
      <BottomSheet
        isPresented={open}
        onIsPresentedChange={setOpen}
        onDismiss={() => onPresent(false)}
        fitToContents
        anchor={
          <Button
            testID="native-composer-context"
            onPress={() => {
              onPresent(true);
              setOpen(true);
              emit({ kind: "press", control: "context" });
            }}
            modifiers={[
              ...controlModifiers({
                label: "Context window",
                color: toneColor(usage.context.tone, dark),
              }),
              accessibilityValue(contextRingValue(percent)),
            ]}
          >
            <ControlFace corners={corners} dark={dark}>
              <ContextRing percent={percent} reduceMotion={reduceMotion} />
            </ControlFace>
          </Button>
        }
      >
        <UsageSheet
          usage={usage}
          dark={dark}
          onRefresh={() => emit({ kind: "press", control: "context-refresh" })}
        />
      </BottomSheet>
    </Host>
  );
}

/**
 * Desktop's ring at the toolbar's icon size: a faint track, and over it an arc of what is used from
 * 12 o'clock clockwise. The stroke takes the button's foreground, so it follows the context tone.
 */
function ContextRing({ percent, reduceMotion }: { percent: number | null; reduceMotion: boolean }) {
  const layer = [frame({ width: 18, height: 18 })];
  return (
    <ZStack modifiers={layer}>
      <Spacer
        modifiers={[
          ...layer,
          strokeBorder({ shape: "circle", style: { lineWidth: 2.25 } }),
          opacity(0.2),
        ]}
      />
      {percent === null ? null : (
        <Spacer
          modifiers={[
            ...layer,
            strokeBorder({ shape: "circle", style: contextRingStroke(percent, 18, 2.25) }),
            rotationEffect(-90),
            ...(reduceMotion ? [] : [animation(Animation.easeInOut({ duration: 0.25 }), percent)]),
          ]}
        />
      )}
    </ZStack>
  );
}

function UsageSheet({
  usage: { context, plan },
  dark,
  onRefresh,
}: {
  usage: NativeUsage;
  dark: boolean;
  onRefresh(): void;
}) {
  const muted = dark ? "#a3a3a3" : "#646464";
  const heading = [font({ size: 17, weight: "semibold" }), lineLimit(1)];
  const detail = [font({ size: 13 }), foregroundStyle(muted)];
  return (
    <VStack
      alignment="leading"
      spacing={20}
      modifiers={[
        padding({ horizontal: 20, top: 28, bottom: 24 }),
        frame({ maxWidth: Infinity, alignment: "leading" }),
        environment("colorScheme", dark ? "dark" : "light"),
        presentationDragIndicator("visible"),
        // Painted explicitly: the sheet's chrome would otherwise follow the phone, not the app.
        presentationBackground(dark ? "#1f1f1f" : "#ffffff"),
      ]}
    >
      <VStack alignment="leading" spacing={8}>
        <Text modifiers={heading}>Context window</Text>
        <Text modifiers={[font({ size: 15 }), foregroundStyle(muted)]}>{context.summary}</Text>
        {context.percent === null ? null : (
          <UsageBar percent={context.percent} tone={context.tone} dark={dark} />
        )}
        {context.detail ? <Text modifiers={detail}>{context.detail}</Text> : null}
      </VStack>
      {plan ? (
        <VStack alignment="leading" spacing={12}>
          <Divider />
          <HStack spacing={8}>
            <Text modifiers={heading}>Plan usage</Text>
            {plan.label ? <Text modifiers={[...detail, lineLimit(1)]}>{plan.label}</Text> : null}
            <Spacer />
            <Button
              testID="native-plan-usage-refresh"
              label="Refresh plan usage"
              systemImage="arrow.clockwise"
              onPress={onRefresh}
              modifiers={[
                buttonStyle("plain"),
                labelStyle("iconOnly"),
                foregroundStyle(muted),
                disabled(plan.loading),
                frame({ width: 44, height: 44 }),
              ]}
            />
          </HStack>
          {plan.error ? (
            <Text
              modifiers={[
                font({ size: 13 }),
                foregroundStyle(toneColors[dark ? "dark" : "light"].danger),
              ]}
            >
              {plan.error}
            </Text>
          ) : null}
          {plan.windows.map((window) => (
            <VStack key={window.id} alignment="leading" spacing={6}>
              <HStack spacing={8}>
                <Text modifiers={[font({ size: 13, weight: "medium" }), lineLimit(1)]}>
                  {window.label}
                </Text>
                <Spacer />
                <Text modifiers={[...detail, monospacedDigit(), lineLimit(1)]}>
                  {window.summary}
                </Text>
              </HStack>
              <UsageBar percent={window.percent} tone={window.tone} dark={dark} />
            </VStack>
          ))}
          {plan.message ? (
            <Text modifiers={[font({ size: 15 }), foregroundStyle(muted)]}>{plan.message}</Text>
          ) : null}
        </VStack>
      ) : null}
    </VStack>
  );
}

function UsageBar({
  percent,
  tone,
  dark,
}: {
  percent: number | null;
  tone: NativeUsage["context"]["tone"];
  dark: boolean;
}) {
  // A window reported without a share keeps an empty track, never an indeterminate spinner.
  return (
    <ProgressView
      value={Math.min(100, Math.max(0, percent ?? 0)) / 100}
      modifiers={[
        progressViewStyle("linear"),
        tint(toneColor(tone, dark) ?? (dark ? "#d4d4d4" : "#3f3f3f")),
      ]}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  control: { width: 44, height: 44, flexShrink: 0 },
  composerFrame: { position: "absolute", bottom: 0, left: 0, right: 0 },
  composer: { flex: 1 },
  collapsed: { flexDirection: "row", alignItems: "center" },
  input: { fontSize: 15, lineHeight: 21, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 },
  collapsedInput: { flex: 1, height: 44, paddingHorizontal: 4, paddingTop: 10 },
  toolbar: { flexDirection: "row", alignItems: "center", height: 44 },
  spacer: { flex: 1 },
});
