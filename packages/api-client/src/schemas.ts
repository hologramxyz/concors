import { MachineIconSchema } from "./machine-icon.ts";
import { z } from "zod";

/**
 * Response shapes of the Concors control-plane API, validated at the boundary so a server change
 * shows up as a clear error instead of `undefined` deep inside the UI.
 *
 * Dates are ISO-8601 strings, exactly as they arrive in JSON.
 */

export const ApiUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ApiUser = z.infer<typeof ApiUserSchema>;

export const ApiSessionSchema = z.object({
  id: z.string(),
  expiresAt: z.string(),
  /** Organization the session currently acts within; null only for legacy sessions. */
  activeOrganizationId: z.string().nullable(),
});
export type ApiSession = z.infer<typeof ApiSessionSchema>;

/** `GET /api/v1/me` */
export const MeSchema = z.object({
  user: ApiUserSchema,
  session: ApiSessionSchema,
});
export type Me = z.infer<typeof MeSchema>;

/** `POST /api/auth/sign-in/email` and `POST /api/auth/sign-up/email` */
export const AuthResponseSchema = z.object({
  /** Session token. `null` when the account still needs e-mail verification before it can sign in. */
  token: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  user: ApiUserSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

/** `POST /api/v1/native-auth/exchange`: the session token a native client uses as its bearer token. */
export const NativeSignInResponseSchema = z.object({ token: z.string().min(1) });

/** `GET /api/v1/native-auth/providers`: sign-in methods this environment has configured. */
export const SignInProvidersSchema = z.object({ github: z.boolean() });
export type SignInProviders = z.infer<typeof SignInProvidersSchema>;

export const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  /** Created automatically for every user; cannot be deleted or shared. */
  isPersonal: z.boolean(),
  /** The current user's role in this organization (owner | admin | member). */
  role: z.string(),
  createdAt: z.string(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

/** `GET /api/v1/organizations` */
export const OrganizationListSchema = z.object({
  organizations: z.array(OrganizationSchema),
});

/** Error bodies: Fastify sends `{ statusCode, error, message }`, Better Auth `{ message, code }`. */
export const ErrorBodySchema = z.object({
  message: z.string(),
  code: z.string().optional(),
});

// --- machines ---------------------------------------------------------------

/** An amount in a currency's major units, e.g. `{ amount: 6.99, currency: "USD" }`. */
export const MoneySchema = z.object({
  amount: z.number(),
  currency: z.string(),
});
export type Money = z.infer<typeof MoneySchema>;

export const MACHINE_STATUSES = [
  "provisioning",
  "running",
  "stopped",
  "error",
  "deleted",
  "unknown",
] as const;
export const MachineStatusSchema = z.enum(MACHINE_STATUSES);
export type MachineStatus = z.infer<typeof MachineStatusSchema>;

const ResourceCapacitySchema = z
  .object({
    totalBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    availableBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .refine((value) => value.availableBytes <= value.totalBytes);
export const MachineResourceUsageSchema = z.object({
  memory: ResourceCapacitySchema.nullable(),
  disk: ResourceCapacitySchema.nullable(),
  sampledAt: z.iso.datetime(),
});
export type MachineResourceUsage = z.infer<typeof MachineResourceUsageSchema>;

export const DevelopmentToolsSchema = z.object({
  node: z.enum(["lts", "24", "22"]).nullable(),
  docker: z.boolean(),
  python: z.boolean().optional(),
  go: z.boolean().optional(),
  rust: z.boolean().optional(),
});
export type DevelopmentTools = z.infer<typeof DevelopmentToolsSchema>;
export const DevelopmentToolsSetupSchema = z.object({
  status: z.enum(["pending", "installing", "ready", "error"]),
  updatedAt: z.iso.datetime(),
  error: z.string().nullable(),
  versions: z.record(z.string(), z.string()),
});

export const MachineSchema = z.object({
  icon: MachineIconSchema.optional(),
  id: z.string(),
  organizationId: z.string(),
  createdByUserId: z.string().nullable(),
  name: z.string(),
  /** Catalog region id, e.g. `US-EAST-VA`. */
  region: z.string(),
  /** Catalog size id, e.g. `small`. */
  size: z.string(),
  /** OVH service name once the VPS exists. */
  serviceName: z.string().nullable(),
  /** OVH order that bought the VPS; null for a reused one. */
  orderId: z.string().nullable(),
  /** `provisioning` until the machine accepts SSH, even once the VPS runs. */
  status: MachineStatusSchema,
  /** Raw OVH state; `order:<status>` while the order is in flight. */
  ovhState: z.string().nullable(),
  lastError: z.string().nullable(),
  ipv4: z.string().nullable(),
  ipv6: z.string().nullable(),
  /** Managed daemon fields; optional for older control planes. */
  hostname: z.string().nullable().optional(),
  certificateExpiresAt: z.string().nullable().optional(),
  agentInstalledAt: z.string().nullable().optional(),
  agentVersion: z.string().nullable().optional(),
  agentSeenAt: z.string().nullable().optional(),
  resourceUsage: MachineResourceUsageSchema.nullable().optional(),
  developmentTools: DevelopmentToolsSchema.nullable().optional(),
  developmentToolsSetup: DevelopmentToolsSetupSchema.nullable().optional(),
  certificateError: z.string().nullable().optional(),
  agentError: z.string().nullable().optional(),
  /** Login user; connect with `ssh <sshUser>@<ipv4>`. */
  sshUser: z.string(),
  /** Set once the machine accepts SSH. */
  accessReadyAt: z.string().nullable(),
  reinstallTaskId: z.string().nullable(),
  /** What the organization pays per month; null when the server has no billing. */
  monthlyPrice: MoneySchema.nullable(),
  /** End of the paid month; a cancelled machine runs until then. */
  paidUntil: z.string().nullable(),
  /** Set once the machine was cancelled; it ends at `paidUntil` unless resumed. */
  cancelledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Machine = z.infer<typeof MachineSchema>;

/** `GET/POST/DELETE /api/v1/machines[/:id]` and `POST /api/v1/machines/:id/resume` */
export const MachineResponseSchema = z.object({ machine: MachineSchema });

/** `POST /api/v1/machines/:id/token` */
export const MachineTokenSchema = z.object({ token: z.string().min(1) });
export type MachineToken = z.infer<typeof MachineTokenSchema>;

/** `GET /api/v1/machines` */
export const MachineListSchema = z.object({ machines: z.array(MachineSchema) });

export const MachineRegionSchema = z.object({
  id: z.string(),
  location: z.string(),
  countryCode: z.string(),
});
export type MachineRegion = z.infer<typeof MachineRegionSchema>;

export const MachineSizeSchema = z.object({
  id: z.string(),
  vcpus: z.number(),
  ramGb: z.number(),
  diskGb: z.number(),
  monthlyPrice: MoneySchema.nullable(),
});
export type MachineSize = z.infer<typeof MachineSizeSchema>;

/** `GET /api/v1/machines/catalog` */
export const MachineCatalogSchema = z.object({
  developmentTools: z
    .object({
      nodeVersions: z.array(z.enum(["lts", "24", "22"])),
      additionalTools: z.array(z.enum(["python", "go", "rust"])).optional(),
    })
    .nullable()
    .optional(),
  regions: z.array(MachineRegionSchema),
  sizes: z.array(MachineSizeSchema),
  /** OS image every machine runs. */
  image: z.string(),
  sshUser: z.string(),
});
export type MachineCatalog = z.infer<typeof MachineCatalogSchema>;

/** `GET /api/v1/machines/costs` */
export const MachineCostsSchema = z.object({
  machines: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      region: z.string(),
      size: z.string(),
      status: MachineStatusSchema,
      monthlyPrice: MoneySchema.nullable(),
      createdAt: z.string(),
    }),
  ),
  /** Sum of the known monthly prices; null when nothing is priced. */
  monthlyTotal: MoneySchema.nullable(),
  unpricedMachines: z.number(),
});
export type MachineCosts = z.infer<typeof MachineCostsSchema>;

// --- ssh keys ---------------------------------------------------------------

export const SshKeySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  createdByUserId: z.string().nullable(),
  name: z.string(),
  /** `ssh-ed25519`, `ssh-rsa`, `ecdsa-sha2-nistp256`, … */
  type: z.string(),
  /** `<type> <base64>`, comment stripped. */
  publicKey: z.string(),
  /** `SHA256:…` as printed by `ssh-keygen -lf`. */
  fingerprint: z.string(),
  createdAt: z.string(),
});
export type SshKey = z.infer<typeof SshKeySchema>;

/** `POST /api/v1/ssh-keys` */
export const SshKeyResponseSchema = z.object({ sshKey: SshKeySchema });

/** `GET /api/v1/ssh-keys` */
export const SshKeyListSchema = z.object({ sshKeys: z.array(SshKeySchema) });

// --- billing ----------------------------------------------------------------

export const CardSummarySchema = z.object({
  brand: z.string(),
  last4: z.string(),
  expMonth: z.number(),
  expYear: z.number(),
});
export type CardSummary = z.infer<typeof CardSummarySchema>;

/** `GET /api/v1/billing` */
export const BillingStatusSchema = z.object({
  /** False when the server runs without Stripe: machines are then free. */
  configured: z.boolean(),
  testMode: z.boolean().default(false),
  hasPaymentMethod: z.boolean(),
  card: CardSummarySchema.nullable(),
  /** Set while the last invoice payment failed. */
  paymentFailedAt: z.string().nullable(),
  prices: z.array(z.object({ size: z.string(), monthlyPrice: MoneySchema })),
});
export type BillingStatus = z.infer<typeof BillingStatusSchema>;

/** `POST /api/v1/billing/setup`, `POST /api/v1/billing/portal` */
export const RedirectSchema = z.object({ url: z.string() });

export const InvoiceSchema = z.object({
  id: z.string(),
  number: z.string().nullable(),
  status: z.string().nullable(),
  amountDue: MoneySchema,
  amountPaid: MoneySchema,
  createdAt: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  hostedInvoiceUrl: z.string().nullable(),
  invoicePdf: z.string().nullable(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

/** `GET /api/v1/billing/invoices` */
export const InvoiceListSchema = z.object({ invoices: z.array(InvoiceSchema) });

export const SetupCheckoutSchema = RedirectSchema.extend({ sessionId: z.string() });
export type SetupCheckout = z.infer<typeof SetupCheckoutSchema>;
export const SetupConfirmationSchema = z.object({
  status: z.enum(["open", "complete", "expired"]),
});
export const MachineSubscriptionSchema = z.object({
  id: z.string(),
  machineId: z.string(),
  machineName: z.string(),
  region: z.string(),
  size: z.string(),
  status: z.string(),
  monthlyPrice: MoneySchema.nullable(),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
});
export type MachineSubscription = z.infer<typeof MachineSubscriptionSchema>;
export const SubscriptionListSchema = z.object({
  subscriptions: z.array(MachineSubscriptionSchema),
});
