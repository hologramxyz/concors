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
