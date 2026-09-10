import { z } from "zod";
import { AgentAttachmentSchema } from "@concors/protocol";

const text = z.string().max(16000);
export const NativeIconSchema = z.enum([
  "menu",
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
const option = z.object({
  id: z.string().max(200),
  label: z.string().max(500),
  selected: z.boolean(),
});
export const NativeControlSchema = z.object({
  id: z.string().max(200),
  label: z.string().max(500),
  icon: NativeIconSchema,
  disabled: z.boolean(),
  options: z.array(option).max(256).optional(),
});
export type NativeControl = z.infer<typeof NativeControlSchema>;
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
    context: z.string().max(1000),
  }),
]);
export type NativeSurfaceContent = z.infer<typeof NativeSurfaceContentSchema>;
export type NativeComposerContent = Extract<NativeSurfaceContent, { kind: "composer" }>;
export const NativeSurfaceSchema = z.object({
  id: z.string().min(1).max(200),
  content: NativeSurfaceContentSchema,
  frame: z.object({
    x: z.number().finite().min(-10000).max(10000),
    y: z.number().finite().min(-10000).max(10000),
    width: z.number().positive().max(10000),
    height: z.number().positive().max(10000),
  }),
});
export type NativeSurface = z.infer<typeof NativeSurfaceSchema>;
/** UI-only events, never arbitrary JS, selectors, daemon operations, or URLs. */
export const NativeSurfaceEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("press"),
    control: z.string().max(200),
    value: z.string().max(200).optional(),
    text: text.optional(),
  }),
  z.object({ kind: z.literal("text"), text, sequence: z.number().int().positive() }),
  z.object({ kind: z.literal("focus"), focused: z.boolean() }),
  z.object({ kind: z.literal("height"), height: z.number().min(48).max(360) }),
  z.object({ kind: z.literal("attachments"), attachments: z.array(AgentAttachmentSchema).max(3) }),
  z.object({ kind: z.literal("swipe"), direction: z.enum(["left", "right"]) }),
]);
export type NativeSurfaceEvent = z.infer<typeof NativeSurfaceEventSchema>;
