import { z } from "zod";
import {
  AgentAttachmentSchema,
  LEGACY_MESSAGE_ATTACHMENTS,
  MAX_UPLOAD_BYTES,
} from "@concors/protocol";

const text = z.string().max(16000);
export const NativeIconSchema = z.enum([
  "menu",
  "search",
  "files",
  "back",
  "chevron",
  "plus",
  "send",
  "stop",
  "model",
  "claude",
  "opencode",
  "pi",
  "brain",
  "shield",
  "options",
  "mic",
]);
export type NativeIcon = z.infer<typeof NativeIconSchema>;
// Model IDs and encoded feature values must survive both sides of the native bridge.
const optionValue = z.string().max(8192);
const option = z.object({
  id: optionValue,
  label: z.string().max(4608),
  selected: z.boolean(),
  /**
   * Keeps the sheet where it is: a row whose ID names another control opens that control as a page,
   * and any other sends its choice and stays, as an update does to show its progress.
   */
  navigate: z.boolean().optional(),
  /** A second line under the label. */
  description: z.string().max(500).optional(),
  /** What the page a navigating row opens is set to, shown beside the label. */
  value: z.string().max(4608).optional(),
  /** Drawn as a switch that `selected` says is on; choosing it flips it. */
  toggle: z.boolean().optional(),
  /** Starts a new group of rows. */
  section: z.boolean().optional(),
  /** Closes the whole sheet even from a page, for a choice that answers with a dialog over it. */
  closes: z.boolean().optional(),
  disabled: z.boolean().optional(),
  /** A workspace's mark before the label: its initial on a tile, or a folder. */
  mark: z.union([z.literal("folder"), z.object({ initial: z.string().min(1).max(4) })]).optional(),
  /** The sidebar's dot on that mark: a chat wants a look, or finished. */
  dot: z.enum(["attention", "done"]).optional(),
});
export const NativeControlSchema = z.object({
  id: z.string().max(200),
  /** Names the button; the title names its menu, and a menu without one has no heading. */
  label: z.string().max(500),
  title: z.string().max(500).optional(),
  icon: NativeIconSchema,
  disabled: z.boolean(),
  options: z.array(option).max(10240).optional(),
});
export type NativeControl = z.infer<typeof NativeControlSchema>;
const usageTone = z.enum(["ok", "warning", "danger"]).nullable();
/**
 * What the composer's context sheet shows, already worded so the native sheet only lays it out
 * and says exactly what the desktop popover says. Percentages drive the bars and their color.
 */
export const NativeUsageSchema = z.object({
  context: z.object({
    summary: z.string().max(200),
    /** Cumulative tokens, when the provider reports them. */
    detail: z.string().max(200).nullable(),
    percent: z.number().min(0).max(100).nullable(),
    tone: usageTone,
  }),
  /** Null when the machine cannot report plan usage at all. */
  plan: z
    .object({
      label: z.string().max(80).nullable(),
      loading: z.boolean(),
      error: z.string().max(500).nullable(),
      /** Shown instead of bars when there are none, e.g. an API-key account. */
      message: z.string().max(500).nullable(),
      windows: z
        .array(
          z.object({
            id: z.string().max(80),
            label: z.string().max(80),
            summary: z.string().max(80),
            percent: z.number().min(0).max(100).nullable(),
            tone: usageTone,
          }),
        )
        .max(12),
    })
    .nullable(),
});
export type NativeUsage = z.infer<typeof NativeUsageSchema>;
export type NativeUsageWindow = NonNullable<NativeUsage["plan"]>["windows"][number];
export const NativeSurfaceContentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("button"),
    label: z.string().max(500),
    title: z.string().max(500),
    subtitle: z.string().max(500).optional(),
    icon: NativeIconSchema,
    disabled: z.boolean().default(false),
    /**
     * Opens this native sheet instead of pressing the button: a row's ID comes back as a press of
     * the menu's ID with that value.
     */
    menu: NativeControlSchema.optional(),
  }),
  z.object({
    kind: z.literal("composer"),
    draft: text,
    editAck: z.number().int().nonnegative(),
    expanded: z.boolean(),
    editable: z.boolean(),
    placeholder: z.string().max(500),
    active: z.boolean(),
    canSend: z.boolean(),
    canStop: z.boolean(),
    hasAttachments: z.boolean(),
    attachEnabled: z.boolean(),
    /**
     * The machine takes files uploaded ahead of a message: any number, each up to the upload
     * limit. Without it, three files of 1 MB at most.
     */
    uploads: z.boolean().optional(),
    /** The toolbar's buttons, and the pages their sheets open: at most one per feature (64). */
    controls: z.array(NativeControlSchema).max(72),
    /** Why the microphone cannot start dictation right now; without it, pressing "dictate" does. */
    dictationHelp: z.string().max(500).nullable().optional(),
    /** Null when the provider reports neither context nor plan usage: there is no sheet. */
    usage: NativeUsageSchema.nullable(),
  }),
]);
export type NativeSurfaceContent = z.infer<typeof NativeSurfaceContentSchema>;
export type NativeComposerContent = Extract<NativeSurfaceContent, { kind: "composer" }>;
const rectangle = z.object({
  x: z.number().finite().min(-10000).max(10000),
  y: z.number().finite().min(-10000).max(10000),
  width: z.number().positive().max(10000),
  height: z.number().positive().max(10000),
});
export const NativeSurfaceSchema = z.object({
  id: z.string().min(1).max(200),
  content: NativeSurfaceContentSchema,
  frame: rectangle,
  /** Visible viewport intersection; native glass must not draw over a covering panel. */
  clip: rectangle.optional(),
  /** Inactive panels remain visible during navigation, but cannot receive actions. */
  interactive: z.boolean().optional(),
});
export type NativeSurface = z.infer<typeof NativeSurfaceSchema>;
/**
 * A file the native picker read whole. Where the machine takes uploads the picker sends one per
 * event, up to the upload limit, and the web composer uploads it; otherwise the old inline limits.
 */
const NativeAttachmentSchema = AgentAttachmentSchema.extend({
  data: z
    .string()
    .max(Math.ceil(MAX_UPLOAD_BYTES / 3) * 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
});
/** UI-only events, never arbitrary JS, selectors, daemon operations, or URLs. */
export const NativeSurfaceEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("press"),
    control: z.string().max(200),
    value: optionValue.optional(),
    text: text.optional(),
  }),
  z.object({ kind: z.literal("text"), text, sequence: z.number().int().positive() }),
  z.object({ kind: z.literal("focus"), focused: z.boolean() }),
  z.object({ kind: z.literal("height"), height: z.number().min(48).max(360) }),
  z.object({
    kind: z.literal("attachments"),
    attachments: z.array(NativeAttachmentSchema).max(LEGACY_MESSAGE_ATTACHMENTS),
  }),
  z.object({ kind: z.literal("swipe"), direction: z.enum(["left", "right"]) }),
]);
export type NativeSurfaceEvent = z.infer<typeof NativeSurfaceEventSchema>;
