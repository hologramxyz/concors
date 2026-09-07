# Accounts and authentication

The desktop app is gated behind a Concors account: a signed-out user sees nothing but the sign-in
screen, and the workspace, machines and agents only render once the control plane
(`concors-server`) confirms the session. This document describes how the client authenticates and
what the server provides for it.

## Flow

```text
┌──────────────┐  POST /api/auth/sign-in/email   ┌────────────────┐
│ Desktop app  │ ───────────────────────────────▶ │ concors-server │
│ (@concors/   │ ◀─────────────────────────────── │ (Better Auth)  │
│  api-client) │  { token, user } + session cookie└────────────────┘
│              │
│   token ──▶ TokenStore (webview storage)
│              │
│              │  GET /api/v1/me   Authorization: Bearer <token>   (+ cookie when same-site)
│              │ ───────────────────────────────▶
│              │ ◀───────────────────────────────  { user, session: { activeOrganizationId } }
└──────────────┘
```

1. **Startup.** While the saved session is checked with `GET /api/v1/me` the app shows a quiet
   splash. A `401` drops the saved token and shows the sign-in screen; any other failure keeps the
   token and shows the sign-in screen with the error and a retry, so a flaky network never destroys
   a valid session.
2. **Sign in / sign up.** Email + password through Better Auth (`/api/auth/sign-in/email`,
   `/api/auth/sign-up/email`). The session token from the response is stored and the session is
   re-checked with `/api/v1/me` so the UI always mirrors what the API believes.
3. **Signed in.** The app renders. The sidebar footer shows the account; Settings → Account shows
   the email, verification state, the active organization (switchable when the user belongs to
   several, via `/api/auth/organization/set-active`) and the session expiry.
4. **Sign out.** The local token is dropped and the sign-in screen returns immediately, then
   `POST /api/auth/sign-out` revokes the session best-effort. Signing out works offline.

Sessions last 30 days and are refreshed by the server while in use, so there is no refresh-token
dance on the client.

## Where things live

| Piece                                          | Role                                                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/api-client`                          | `@concors/api-client`: fetch-based, host-agnostic client. Validates responses with Zod. Shared with the future mobile app. |
| `apps/desktop/src/auth/api.ts`                 | The app's single `ApiClient`, pointed at `VITE_CONCORS_API_URL`.                                                           |
| `apps/desktop/src/auth/token-store.ts`         | Keeps the session token in webview `localStorage` (memory fallback).                                                       |
| `apps/desktop/src/auth/auth-state.ts`          | `AuthState` machine and error-to-message mapping. Pure, unit-tested.                                                       |
| `apps/desktop/src/auth/use-auth.ts`            | React hook: restore on mount, sign in/up/out, organization switch.                                                         |
| `apps/desktop/src/auth/auth-screen.tsx`        | Full-screen sign-in / create-account gate (the only UI while signed out).                                                  |
| `apps/desktop/src/components/account-menu.tsx` | Sidebar footer account widget.                                                                                             |

## Two credentials, one code path

Every request carries `credentials: "include"` **and**, when a token is stored,
`Authorization: Bearer <token>`.

- **Browser preview / web app (same-site).** The HttpOnly session cookie does the work. The desktop
  dev server proxies `/api/*` to the real API when `CONCORS_API_PROXY_TARGET` is set (see
  `apps/desktop/.env.example`), so `http://localhost:1420` is same-origin with the API from the
  browser's point of view and no CORS or cookie tweaks are needed.
- **Packaged desktop app (cross-site).** The webview origin is `tauri://localhost` (macOS/Linux) or
  `http://tauri.localhost` (Windows). Cookies with `SameSite=Lax` are not sent cross-site, so the
  bearer token is the credential that matters.

### Token storage

The token is the user's credential, not an application secret, and lives in the webview's
`localStorage` behind the `TokenStore` interface. Planned hardening for the packaged app: a
keychain-backed store exposed through `apps/desktop/src/tauri/`, swapped in without touching the
API client. The mobile app will use its platform secure store the same way.

## What the server provides (and every deployment needs)

Both were added to `concors-server` and its `dev` Railway environment on 2026-09-07. New
environments must carry them too, or native builds cannot sign in (the browser preview would still
work through the dev proxy).

1. **Bearer tokens.** Better Auth's `bearer()` plugin is registered in `src/modules/auth/auth.ts`.
   With its default options it accepts the raw `token` that sign-in returns in its body as
   `Authorization: Bearer …`, and also exposes a signed token in a `set-auth-token` response header;
   the client prefers the header when present.
2. **Allowed origins.** `CORS_ORIGINS` (also Better Auth's `trustedOrigins`) includes the desktop
   origins `tauri://localhost`, `http://tauri.localhost` and `https://tauri.localhost`, plus
   `http://localhost:1420` for the desktop dev server.

Nice to have, not blocking: `/api/v1/me` could additionally return the active organization's name
to save the client one request.

## Endpoints used by the client

| Method | Path                                | Purpose                                         |
| ------ | ----------------------------------- | ----------------------------------------------- |
| POST   | `/api/auth/sign-up/email`           | `{ name, email, password }` → `{ token, user }` |
| POST   | `/api/auth/sign-in/email`           | `{ email, password }` → `{ token, user }`       |
| POST   | `/api/auth/sign-out`                | Revoke the session                              |
| GET    | `/api/v1/me`                        | Current user + session (active organization)    |
| GET    | `/api/v1/organizations`             | Organizations of the user, personal first       |
| POST   | `/api/auth/organization/set-active` | `{ organizationId }`                            |
| GET    | `/api/v1/machines/catalog`          | Regions, sizes and prices for new machines      |
| GET    | `/api/v1/machines`                  | Machines of an organization                     |
| POST   | `/api/v1/machines`                  | `{ name, region, size }` → `{ machine }`        |
| GET    | `/api/v1/machines/:id`              | One machine, refreshed from OVH                 |
| DELETE | `/api/v1/machines/:id`              | Destroy a machine                               |
| GET    | `/api/v1/machines/costs`            | Monthly cost of an organization's machines      |
| GET    | `/api/v1/ssh-keys`                  | SSH keys of an organization                     |
| POST   | `/api/v1/ssh-keys`                  | `{ name, publicKey }` → `{ sshKey }`            |
| DELETE | `/api/v1/ssh-keys/:id`              | Remove a key                                    |
| GET    | `/api/v1/billing`                   | Card on file, payment trouble, machine prices   |
| POST   | `/api/v1/billing/setup`             | Stripe Checkout URL to save a card              |
| POST   | `/api/v1/billing/portal`            | Stripe customer portal URL                      |
| GET    | `/api/v1/billing/invoices`          | Invoices of an organization                     |

Error bodies come in two shapes and are both mapped to `ApiError`: Fastify's
`{ statusCode, error, message }` and Better Auth's `{ message, code }` (for example
`INVALID_EMAIL_OR_PASSWORD`, `USER_ALREADY_EXISTS`).

## Out of scope for now

- OAuth / social sign-in. The server has no providers registered yet; once it does, the desktop
  flow needs a system-browser round trip with a deep link back into the app.
- Password reset and e-mail verification screens (the server has no e-mail provider wired up).
- Connecting the workspace to a **cloud machine's daemon**. Machines can be created and destroyed
  from the Machines view and reached over SSH, but the machine switcher still only knows manually
  added daemon URLs.
