import { z } from "zod";
import {
  MachineSchema,
  MachineIconSchema,
  MeSchema,
  MobileCapabilitiesSchema,
  OrganizationSchema,
} from "@concors/api-client";
import { ClientMessageSchema, DaemonMessageSchema, ThemeSelectionSchema } from "@concors/protocol";
import { NativeSurfaceSchema, NativeSurfaceEventSchema } from "./native-surfaces.ts";

const id = z.string().min(1).max(200);
const scope = z.object({ organizationId: id.optional() });
const scoped = z.tuple([scope.optional()]);
const empty = z.tuple([]);
const page = z.number().int().positive().max(10000);
/** Deliberately no generic fetch, token access, sign-in, or connection-ticket RPC. */
export const MobileApiCallSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("getMachineCatalog"), args: empty }),
  z.object({ method: z.literal("listMachines"), args: scoped }),
  z.object({ method: z.literal("getMachine"), args: z.tuple([id]) }),
  z.object({
    method: z.literal("renameMachine"),
    args: z.tuple([id, z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)]),
  }),
  z.object({ method: z.literal("updateMachineIcon"), args: z.tuple([id, MachineIconSchema]) }),
  z.object({ method: z.literal("githubStatus"), args: empty }),
  z.object({ method: z.literal("connectGitHub"), args: empty }),
  z.object({ method: z.literal("disconnectGitHub"), args: empty }),
  z.object({ method: z.literal("githubAccounts"), args: z.tuple([page.optional()]) }),
  z.object({
    method: z.literal("githubRepositories"),
    args: z.tuple([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), page.optional()]),
  }),
  z.object({
    method: z.literal("prepareGitHubMachine"),
    args: z.tuple([
      id,
      z
        .string()
        .max(300)
        .regex(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/)
        .refine((value) => ![".", ".."].includes(value.split("/")[1] ?? "")),
    ]),
  }),
  z.object({
    method: z.literal("createMachine"),
    args: z.tuple([scope.extend({ name: z.string().min(1).max(63), region: id, size: id })]),
  }),
  z.object({ method: z.literal("cancelMachine"), args: z.tuple([id]) }),
  z.object({ method: z.literal("resumeMachine"), args: z.tuple([id]) }),
  z.object({ method: z.literal("getMachineCosts"), args: scoped }),
  z.object({ method: z.literal("listSshKeys"), args: scoped }),
  z.object({
    method: z.literal("addSshKey"),
    args: z.tuple([
      scope.extend({ name: z.string().min(1).max(200), publicKey: z.string().min(1).max(16384) }),
    ]),
  }),
  z.object({ method: z.literal("removeSshKey"), args: z.tuple([id]) }),
  z.object({ method: z.literal("getBillingStatus"), args: scoped }),
  z.object({ method: z.literal("createBillingSetupUrl"), args: scoped }),
  z.object({ method: z.literal("createBillingPortalUrl"), args: scoped }),
  z.object({ method: z.literal("listInvoices"), args: scoped }),
]);
export type MobileApiCall = z.infer<typeof MobileApiCallSchema>;
export const MobileTargetSchema = z.object({
  machineId: id.optional(),
  projectId: id.optional(),
  tabId: id.optional(),
  paneId: id.optional(),
  sessionId: id.optional(),
});
export type MobileTarget = z.infer<typeof MobileTargetSchema>;
export const MobilePreferencesSchema = z.object({
  theme: z.enum(["system", "light", "dark"]),
  colorTheme: ThemeSelectionSchema.optional(),
  corners: z.enum(["square", "subtle", "rounded"]),
  sound: z.boolean().default(false),
});
export type MobilePreferences = z.infer<typeof MobilePreferencesSchema>;
export const MobileStateSchema = z.object({
  scope: id,
  me: MeSchema.nullable(),
  /** Display-only profile verified by preview sign-in; never grants machine/cloud API access. */
  profile: z
    .object({ name: z.string().max(500), email: z.string().max(500) })
    .nullable()
    .optional(),
  direct: z.boolean().default(false),
  organizations: z.array(OrganizationSchema),
  machines: z.array(MachineSchema),
  machineId: id.nullable(),
  connectionId: id.nullable(),
  phase: z.enum(["idle", "connecting", "ready", "reconnecting", "paused", "error"]),
  message: z.string().nullable(),
  capabilities: MobileCapabilitiesSchema,
  demo: z.boolean(),
  native: z.boolean(),
  nativeChrome: z.boolean().optional(),
  systemDark: z.boolean(),
  preferences: MobilePreferencesSchema,
  pushEnabled: z.boolean(),
  target: MobileTargetSchema,
  supportUrl: z.string(),
  privacyUrl: z.string(),
  apiUrl: z.string(),
  endpointLabel: z.string(),
});
export type MobileState = z.infer<typeof MobileStateSchema>;
export const MobileActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("api"), call: MobileApiCallSchema }),
  z.object({ kind: z.literal("select-machine"), machineId: id }),
  z.object({ kind: z.literal("retry") }),
  z.object({ kind: z.literal("refresh") }),
  z.object({ kind: z.literal("sign-out") }),
  z.object({ kind: z.literal("open-profile") }),
  z.object({ kind: z.literal("switch-organization"), organizationId: id }),
  z.object({ kind: z.literal("push"), enabled: z.boolean() }),
  z.object({
    kind: z.literal("delete-account"),
    password: z.string().min(1).max(4096),
    confirmation: z.literal("DELETE"),
  }),
  z.object({ kind: z.literal("open-url"), url: z.string().max(4096) }),
  z.object({ kind: z.literal("clipboard"), text: z.string().max(1_000_000) }),
  z.object({ kind: z.literal("preferences"), preferences: MobilePreferencesSchema }),
  z.object({ kind: z.literal("file-guard"), active: z.boolean() }),
  z.object({ kind: z.literal("dismiss-keyboard") }),
  z.object({ kind: z.literal("withdraw-ai-consent") }),
]);
export type MobileAction = z.infer<typeof MobileActionSchema>;
export const MobileRendererMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({
    type: z.literal("native-surfaces"),
    scope: id,
    connectionId: id.nullable(),
    surfaces: z.array(NativeSurfaceSchema).max(8),
    viewport: z.object({
      width: z.number().positive().max(10000),
      height: z.number().positive().max(10000),
    }),
  }),
  z.object({ type: z.literal("protocol"), connectionId: id, message: ClientMessageSchema }),
  z.object({
    type: z.literal("action"),
    scope: id,
    requestId: z.uuid(),
    action: MobileActionSchema,
  }),
]);
export type MobileRendererMessage = z.infer<typeof MobileRendererMessageSchema>;
export const MobileHostMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), state: MobileStateSchema }),
  z.object({
    type: z.literal("native-event"),
    scope: id,
    connectionId: id.nullable(),
    surfaceId: id,
    event: NativeSurfaceEventSchema,
  }),
  z.object({ type: z.literal("protocol"), connectionId: id, message: DaemonMessageSchema }),
  z.object({
    type: z.literal("result"),
    scope: id,
    requestId: z.uuid(),
    result: z.unknown().optional(),
    error: z
      .object({ message: z.string(), status: z.number().optional(), code: z.string().optional() })
      .optional(),
  }),
]);
export type MobileHostMessage = z.infer<typeof MobileHostMessageSchema>;

export function parseMobileRendererMessage(raw: unknown): MobileRendererMessage | null {
  try {
    if (typeof raw === "string" && raw.length > 5_000_000) return null;
    const parsed = MobileRendererMessageSchema.safeParse(
      typeof raw === "string" ? JSON.parse(raw) : raw,
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
