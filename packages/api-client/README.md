# @concors/api-client

Platform-agnostic client for the Concors control-plane API (`concors-server`). Depends only on
`zod` and WHATWG `fetch`, so the same code runs in the Tauri desktop app, a browser, React Native
and Node.

```ts
import { ApiError, createApiClient } from "@concors/api-client";

const api = createApiClient({ baseUrl: "https://api.concors.dev", tokenStore });

// Sign-in runs in the system browser: open `api.nativeSignInUrl(target, challenge)`, then redeem
// the code it returns with `api.completeNativeSignIn({ code, verifier })`, which stores the
// session token in `tokenStore`.
const me = await api.getMe(); // { user, session: { activeOrganizationId, … } }
const orgs = await api.listOrganizations();
await api.signOut(); // drops the token; revoking the server session is best-effort

try {
  await api.getMe();
} catch (error) {
  if (error instanceof ApiError && error.unauthorized) {
    // session expired or revoked → show the sign-in screen
  }
}
```

## Design notes

- **Two credentials, one code path.** Every request carries `Authorization: Bearer <token>` when a
  token is stored _and_ `credentials: "include"`. Native hosts (Tauri, React Native) are
  cross-site to the API and use the bearer token; same-site hosts (the web app, the desktop dev
  server proxying `/api`) get the HttpOnly cookie for free.
- **`TokenStore` is the host's decision.** The package ships only `memoryTokenStore()`. The desktop
  app plugs in webview storage today and can swap in a keychain-backed store without touching this
  package; React Native will use its secure store.
- **Validated at the boundary.** Responses are parsed with the schemas in `src/schemas.ts`; a server
  change fails loudly with `ApiError("INVALID_RESPONSE")` instead of leaking `undefined` into the UI.
- **No framework.** A handful of methods over `fetch` is all the clients need right now, and no
  identity provider SDK: the sign-in page lives on the API, so clients only see its result.

See [`docs/auth.md`](../../docs/auth.md) for the end-to-end flow and the server-side prerequisites.
