/**
 * @concors/api-client
 *
 * Talks to the Concors control plane (accounts, organizations and, later, cloud machines) using
 * nothing but WHATWG `fetch`. Works unchanged in the Tauri desktop app, a browser, React Native
 * and Node. It knows nothing about daemons; that is `@concors/daemon-client`.
 */

export {
  ApiClient,
  createApiClient,
  type ApiClientOptions,
  type SignInInput,
  type SignUpInput,
} from "./client.ts";
export { ApiError, ApiNetworkError } from "./errors.ts";
export {
  ApiSessionSchema,
  ApiUserSchema,
  AuthResponseSchema,
  MeSchema,
  OrganizationListSchema,
  OrganizationSchema,
  type ApiSession,
  type ApiUser,
  type AuthResponse,
  type Me,
  type Organization,
} from "./schemas.ts";
export { memoryTokenStore, type TokenStore } from "./token-store.ts";
