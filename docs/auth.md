# Accounts and authentication

The desktop app is gated behind a Concors account: a signed-out user sees nothing but the sign-in
screen, and the workspace, machines and agents only render once the control plane
(`concors-server`) confirms the session. This document describes how the client authenticates and
what the server provides for it.

## Flow

```text
┌──────────────┐  opens /api/v1/native-auth/start   ┌──────────────────────────┐
│ Desktop or   │ ─────── in the browser ──────────▶ │ concors-server sign-in   │
│ mobile app   │                                    │ page (Privy: GitHub,     │
│ (@concors/   │ ◀── one-time code to loopback ──── │ Google or emailed code)  │
│  api-client) │     port or app scheme             └──────────────────────────┘
│              │
│              │  POST /api/v1/native-auth/exchange { code, verifier } → { token }
│   token ──▶ TokenStore
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
2. **Sign in.** The person chooses **Sign in** or **Sign up**, then **GitHub**, **Google** or
   **email** (typing the address in the app). The browser opens straight on that method, on a page
   the API hosts: GitHub's or Google's own sign-in, or a box for the code just emailed. There is no
   password: see [Browser sign-in](#browser-sign-in). The session token the exchange returns is
   stored and the session is re-checked with `/api/v1/me` so the UI always mirrors what the API
   believes.
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
| `apps/desktop/src/auth/use-auth.ts`            | React hook: restore on mount, sign in/out, organization switch.                                                            |
| `apps/desktop/src/auth/sign-in.ts`             | Browser sign-in over the loopback port, and whether it can be offered here.                                                |
| `apps/desktop/src/auth/auth-screen.tsx`        | Full-screen sign-in gate (the only UI while signed out).                                                                   |
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

1. **Bearer tokens.** `/api/v1/*` and the remaining `/api/auth/*` routes accept the session token
   as `Authorization: Bearer …`. Native builds depend on it.
2. **Allowed origins.** `CORS_ORIGINS` includes the desktop origins `tauri://localhost`,
   `http://tauri.localhost` and `https://tauri.localhost`, plus `http://localhost:1420` for the
   desktop dev server.
3. **An identity provider.** Sign-in is powered by Privy on the server. Without it configured,
   `/api/v1/native-auth/providers` reports nothing available and the apps say sign-in is not set
   up rather than opening a page that fails. Server setup is documented in concors-server.

Nice to have, not blocking: `/api/v1/me` could additionally return the active organization's name
to save the client one request.

## Endpoints used by the client

| Method | Path                                | Purpose                                           |
| ------ | ----------------------------------- | ------------------------------------------------- |
| GET    | `/api/v1/native-auth/providers`     | `{ github, google, email }`: methods on offer     |
| GET    | `/api/v1/native-auth/start`         | Sign-in page, opened in the browser (not fetched) |
| POST   | `/api/v1/native-auth/exchange`      | `{ code, verifier }` → `{ token }`                |
| POST   | `/api/auth/sign-out`                | Revoke the session                                |
| GET    | `/api/v1/me`                        | Current user + session (active organization)      |
| GET    | `/api/v1/organizations`             | Organizations of the user, personal first         |
| POST   | `/api/auth/organization/set-active` | `{ organizationId }`                              |
| GET    | `/api/v1/machines/catalog`          | Regions, sizes and prices for new machines        |
| GET    | `/api/v1/machines`                  | Machines of an organization                       |
| POST   | `/api/v1/machines`                  | `{ name, region, size }` → `{ machine }`          |
| GET    | `/api/v1/machines/:id`              | One machine, refreshed from OVH                   |
| DELETE | `/api/v1/machines/:id`              | Cancel a machine (runs until the paid month ends) |
| POST   | `/api/v1/machines/:id/resume`       | Undo a cancellation                               |
| GET    | `/api/v1/machines/costs`            | Monthly cost of an organization's machines        |
| GET    | `/api/v1/ssh-keys`                  | SSH keys of an organization                       |
| POST   | `/api/v1/ssh-keys`                  | `{ name, publicKey }` → `{ sshKey }`              |
| DELETE | `/api/v1/ssh-keys/:id`              | Remove a key                                      |
| GET    | `/api/v1/billing`                   | Card on file, payment trouble, machine prices     |
| POST   | `/api/v1/billing/setup`             | Stripe Checkout URL to save a card                |
| POST   | `/api/v1/billing/portal`            | Stripe customer portal URL                        |
| GET    | `/api/v1/billing/invoices`          | Invoices of an organization                       |

Error bodies (Fastify's `{ statusCode, error, message }`, sometimes with a `code`) are mapped to
`ApiError`.

## Browser sign-in

Every sign-in happens in a browser, on a Privy-powered page the API itself hosts, which goes
straight to the method picked in the app: GitHub, Google, or a one-time code sent to the address
typed in the app. The page is Concors' own (Privy's headless hooks, no Privy modal). The apps never
talk to Privy and carry no Privy SDK: they only open the page and redeem what it returns.

**Sign up** creates the account on first use, or just signs in when it exists. **Sign in** never
creates one: without a matching account the app gets `account_not_found` and suggests signing up,
so trying a second method under another address does not quietly create a second, empty account.

Browser builds (the desktop web preview and the mobile web export) do not offer it — the result can
only return to a native app — and explain that in place of the button. The native apps hide the
button only when the API explicitly reports no method configured
(`GET /api/v1/native-auth/providers`); while that check is pending or failing, desktop still offers
it, and mobile shows a retry.

Both apps follow RFC 8252 — a browser for the sign-in page, the result returned only to the app
that started it, and PKCE — and share parsing, error messages and PKCE encoding from
`packages/client-core/src/sign-in.ts`:

|                   | Desktop                                                                     | Mobile                                                                                                           |
| ----------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Browser           | System browser                                                              | In-app authentication session: `ASWebAuthenticationSession` (iOS), Custom Tabs (Android), via `expo-web-browser` |
| Result returns to | One-shot listener on `127.0.0.1:<random port>` (`src-tauri/src/sign_in.rs`) | The build's URL scheme, `<scheme>://native-auth/callback`                                                        |
| Flow              | `apps/desktop/src/auth/sign-in.ts`                                          | `apps/mobile/src/auth/sign-in.ts`                                                                                |

In both, the app creates a PKCE verifier, opens `/api/v1/native-auth/start` with `port=…` or
`app=<scheme>`, the challenge, and the choice (`method`, `email`, `intent`), receives a one-time code, and redeems it with
`ApiClient.completeNativeSignIn` for the session token. (`/api/v1/native-auth/github/start` is a
deprecated alias the server keeps for older builds.)

Why this shape:

- **Not phishable like polling.** With polling, an attacker could start sign-in and send someone the
  browser link. Here the code only reaches the machine or app that started the attempt.
- **A captured or injected code is useless.** Redeeming one needs the verifier that never left the
  app. That covers a page requesting the desktop loopback port and another mobile app claiming the
  same URL scheme; the API also only returns to its allowlist of Concors schemes.
- **No OS registration on desktop.** A deep link needs a URL scheme registered per platform (on
  Linux, a `MimeType` in the desktop entry) and does not work in development builds.
- **Credentials stay with the provider.** People authenticate on GitHub's or Google's own page, or
  with a code from their inbox, with their password manager and passkeys, and an existing browser
  login is reused. The apps never see those credentials.

Closing the page, cancelling on it or closing the mobile sheet (`cancelled`, `access_denied`)
returns quietly to the sign-in screen. `email_required` means the account had no usable email — for
example a GitHub account without a verified address — and the app suggests email, Google, or a
GitHub account with a verified email. Any other code reads as a generic "did not complete".

**Existing accounts.** Accounts from before Privy (email and password, or the earlier GitHub
sign-in) are linked automatically the first time their owner signs in through Privy: by the GitHub
account id the old GitHub sign-in recorded, or else by the verified email address. Nobody needs to
do anything, and organizations, machines and billing stay where they were.

`expo-web-browser` is a native module: mobile needs a new development client or store build before
the button works on a device. Android also delivers the callback as a deep link, which
`apps/mobile/app/native-auth/callback.tsx` absorbs.

The private direct-daemon preview on mobile still has an optional profile sign-in that posts an
email and password through its gateway (`apps/mobile/src/auth/direct-profile.ts`). Account APIs
that sign in only through the browser refuse it.

## Out of scope for now

- Connecting the workspace to a **cloud machine's daemon**. Machines can be created and destroyed
  from the Machines view and reached over SSH, but the machine switcher still only knows manually
  added daemon URLs.
