import { createApiClient } from "@concors/api-client";

import { env } from "@/config/env";

import { webStorageTokenStore } from "./token-store.ts";

/** The one control-plane client of the app. `env.apiUrl` is public build-time configuration. */
export const api = createApiClient({ baseUrl: env.apiUrl, tokenStore: webStorageTokenStore() });

/** The mobile build supplies an opaque host scope instead of a renderer token store. */
export function getApiCacheScope() {
  return api.tokens.get();
}
