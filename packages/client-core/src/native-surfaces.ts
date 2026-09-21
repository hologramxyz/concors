import { z } from "zod";
import { AgentAttachmentSchema } from "@concors/protocol";

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
  "context",
  "mic",
]);
export type NativeIcon = z.infer<typeof NativeIconSchema>;
// Model IDs and encoded feature values must survive both sides of the native bridge.
const optionValue = z.string().max(8192);
const option = z.object({
  id: optionValue,
  label: z.string().max(4608),
  selected: z.boolean(),
});
export const NativeControlSchema = z.object({
  id: z.string().max(200),
  label: z.string().max(500),
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
    controls: z.array(NativeControlSchema).max(4),
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
  z.object({ kind: z.literal("attachments"), attachments: z.array(AgentAttachmentSchema).max(3) }),
  z.object({ kind: z.literal("swipe"), direction: z.enum(["left", "right"]) }),
]);
export type NativeSurfaceEvent = z.infer<typeof NativeSurfaceEventSchema>;
