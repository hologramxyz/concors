import { createApiClient } from "@concors/api-client";

import { env } from "@/config/env";

import { webStorageTokenStore } from "./token-store.ts";

/** The one control-plane client of the app. `env.apiUrl` is public build-time configuration. */
export const api = createApiClient({ baseUrl: env.apiUrl, tokenStore: webStorageTokenStore() });
