/**
 * @concors/api-client
 *
 * Talks to the Concors control plane (accounts, organizations, machines, SSH keys, billing) using
 * nothing but WHATWG `fetch`. Works unchanged in the Tauri desktop app, a browser, React Native
 * and Node. It knows nothing about daemons; that is `@concors/daemon-client`.
 */

export {
  ApiClient,
  createApiClient,
  type AddSshKeyInput,
  type ApiClientOptions,
  type CreateMachineInput,
  type NativeSignInTarget,
  type OrganizationScope,
  type SignInInput,
  type SignUpInput,
} from "./client.ts";
export { ApiError, ApiNetworkError } from "./errors.ts";
export {
  ApiSessionSchema,
  ApiUserSchema,
  AuthResponseSchema,
  BillingStatusSchema,
  SetupCheckoutSchema,
  SetupConfirmationSchema,
  SubscriptionListSchema,
  MachineSubscriptionSchema,
  type SetupCheckout,
  type MachineSubscription,
  CardSummarySchema,
  InvoiceListSchema,
  InvoiceSchema,
  MACHINE_STATUSES,
  MachineCatalogSchema,
  MachineCostsSchema,
  MachineListSchema,
  MachineRegionSchema,
  MachineResponseSchema,
  MachineSchema,
  MachineTokenSchema,
  type MachineToken,
  MachineSizeSchema,
  MachineStatusSchema,
  MeSchema,
  MoneySchema,
  OrganizationListSchema,
  OrganizationSchema,
  RedirectSchema,
  SshKeyListSchema,
  SshKeyResponseSchema,
  SshKeySchema,
  type ApiSession,
  type ApiUser,
  type AuthResponse,
  type SignInProviders,
  type BillingStatus,
  type CardSummary,
  type Invoice,
  type Machine,
  type MachineCatalog,
  type MachineCosts,
  type MachineRegion,
  type MachineSize,
  type MachineStatus,
  type Me,
  type Money,
  type Organization,
  type SshKey,
} from "./schemas.ts";
export { memoryTokenStore, type TokenStore } from "./token-store.ts";
export {
  MobileCapabilitiesSchema,
  MachineConnectionTicketSchema,
  MachineAccessTokenSchema,
  PushDeviceSchema,
  NO_MOBILE_CAPABILITIES,
  AccountDeletionSchema,
  type MobileCapabilities,
  type MachineConnectionTicket,
  type MachineAccessToken,
  type PushDevice,
} from "./mobile.ts";

export {
  DevelopmentToolsSchema,
  DevelopmentToolsSetupSchema,
  type DevelopmentTools,
} from "./schemas.ts";

export {
  GitHubStatusSchema,
  GitHubAccountsSchema,
  GitHubRepositoriesSchema,
  type GitHubStatus,
  type GitHubRepository,
} from "./github.ts";

export { MachineIconSchema } from "./machine-icon.ts";
