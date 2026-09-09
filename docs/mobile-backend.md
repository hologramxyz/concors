# Mobile backend integration contract

This is a **source-verified integration assessment plus proposals**, not a claim that
the current deployment or a real mobile session has been tested. No `concors-server`
implementation is included in this client PR.

## What exists now (2026-09-09)

Upstream server revision
[`2f2ea5a`](https://github.com/concors-dev/concors-server/commit/2f2ea5ac1c659ec7240f2570db9b79e97da3348a)
adds a machine agent. This supersedes the earlier assessment of `50d5a6d`:

- Control-plane accounts, organizations and machine lifecycle already exist.
- Machines now report hostname, certificate expiry/error and agent installation,
  version, last-seen and error metadata. The client preserves these optional fields
  while still accepting older deployments.
- `POST /api/v1/machines/:id/token` returns `{machineId, token, expiresAt}`. The token
  is a 15-minute EdDSA JWT scoped to the machine audience, user, session and organization;
  verification keys are exposed at `/.well-known/jwks.json`. This is **not** the
  previously proposed short-lived, one-use connection ticket.
- The machine agent serves TLS on port 443. It exposes `/health`, list/create/delete
  `/sessions`, and `/sessions/:id/attach` over WebSocket. Sessions use persistent tmux;
  the socket carries terminal bytes and resize/exit messages.
- The agent accepts bearer authentication. Although upstream also accepts query-string
  tokens, the mobile client must not put credentials in URLs or renderer state.

See the pinned [machine routes](https://github.com/concors-dev/concors-server/blob/2f2ea5ac1c659ec7240f2570db9b79e97da3348a/src/modules/machines/machines.routes.ts),
[token implementation](https://github.com/concors-dev/concors-server/blob/2f2ea5ac1c659ec7240f2570db9b79e97da3348a/src/lib/machine-tokens.ts)
and [agent server](https://github.com/concors-dev/concors-server/blob/2f2ea5ac1c659ec7240f2570db9b79e97da3348a/packages/agent/src/server.ts).

**The integration gap:** this terminal-session protocol is not Concors v1. It does not
provide the workspace snapshots, tab/pane operations, agent chat/tool events and
approval messages consumed by the shared desktop/mobile UI. Changing a URL or token
alone cannot give feature parity. The Concors daemon in this repository already
implements those workspace, terminal and agent sessions.

## Next: authenticated workspace bridge

In a companion backend PR, add an explicit versioned capability/route to the new machine
agent that forwards Concors v1 to the existing daemon on loopback. Keep the machine's
TLS and access-token infrastructure; do not expose the daemon directly or reimplement
chat using raw terminal output. Resolve route naming, daemon installation/lifecycle and
the WebSocket credential handshake with the backend owner before client transport changes.

The bridge must validate signature/issuer/audience/expiry and current authorization,
preserve protocol negotiation, enforce machine identity, redact credentials, and define
active-socket expiry and revocation behavior. A 15-minute JWT does not by itself prove
immediate logout/membership-removal revocation. Native credentials stay in the host;
browser-compatible authentication must avoid URL tokens. Use a one-use exchange only
if required by the agreed browser handshake, not as a parallel replacement access system.

The shared API now supports `getMachineAccessToken()` with response shape, requested-machine
and expiry validation, but it is **not wired into the mobile workspace transport**.
The existing client still gates workspace connections on mobile capabilities and the
earlier ticket contract below. Enable/change that path only when a real bridge supports it.

Run `pnpm --filter @concors/mobile live:preflight` with private environment configuration
described in the [mobile README](../apps/mobile/README.md). It reads account, machine and
capability state, rejects missing/cross-organization machines, and reports blockers.
It never creates a session or claims that a live connection was verified. Installation
metadata is evidence of provisioning, not proof of workspace/chat support.

## Existing contracts reused

Native sign-in/sign-out and `/api/v1/me` use bearer tokens, not browser cookies or a
Vite proxy. Sign-in must supply a token in the body or exposed response header.
Organizations/machines use `@concors/api-client`. Daemon traffic uses Concors v1 through
`DaemonConnection`: epochs, expected versions, stable pane/session IDs, bounded history,
PTY ownership and attach snapshots retain their existing meaning. No protocol fork.

## Remaining proposed routes (not found in reviewed upstream source)

Authenticate and authorize membership on every request. Use usual `{code,message}`
errors with meaningful HTTP statuses. Schemas/client validation are in
`packages/api-client/src/mobile.ts` and `client.ts`.

| Route                                           | Request                                            | Success body                                                                         |
| ----------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /api/v1/mobile/capabilities`               | —                                                  | `{version:1,remoteAccess:boolean,pushNotifications:boolean,accountDeletion:boolean}` |
| `POST /api/v1/mobile/devices`                   | `{installationId,token,platform:"ios"\|"android"}` | Any successful 2xx body                                                              |
| `DELETE /api/v1/mobile/devices/:installationId` | —                                                  | Any successful 2xx body                                                              |
| `POST /api/v1/account/deletion`                 | `{password}`                                       | `{status:"deleted"\|"scheduled"}`                                                    |

Only a 404 capability response means an unsupported older server. Authentication,
service errors and malformed responses are not silently converted into feature flags.

### Earlier daemon-ticket proposal (not the new agent's current contract)

The client has an implementation for `POST /api/v1/machines/:id/connect` returning
`{machineId,url,ticket,expiresAt}`. The server has not implemented this route. Retain it
as a reference while agreeing the bridge above; do not mistake it for `/token` or
implement a second gateway without reconciling the existing machine-agent architecture.

Return a WSS URL without credentials/query/fragment; a base64url ticket (16–2048 chars)
scoped to the user, organization and exact machine; and a UTC ISO expiry. Recommended
lifetime 30–60 seconds with one-use redemption. Client rejects wrong-machine tickets
and expiry within five seconds.

WebSocket offers `Sec-WebSocket-Protocol: concors.v1, ticket.<ticket>`. Validate and
atomically consume the ticket **before** forwarding, negotiate only `concors.v1`, strip
the credential protocol upstream and redact handshake headers from logs. Reject replay,
expiry and cross-tenant access. Never send the control-plane session token to the daemon.
Authorize/verify daemon identity before minting; client also checks snapshot machine ID.

Revoke grants and active sockets on logout, membership removal and account deletion.
Rate-limit minting, validate browser Origin where applicable without treating Origin as
native authentication. The daemon must be installed/healthy behind the gateway; an IP
address is not a complete mobile access path. Private WSS testing overrides are not
production authorization.

Acceptance: correct/wrong organization, replay/expiry, removed membership, logout with
open socket, daemon offline/restart, network transitions, desktop/phone concurrency.
Every resume/reconnect requests a fresh ticket and authoritative snapshot.

### Push

`installationId` is a device UUID; `token` is an Expo push token. Derive ownership from
the authenticated session, never a client user ID. Registration is idempotent; account
switches atomically reassign/revoke ownership. Unregister is idempotent and rejects
cross-user deletion. Session/account revocation removes registrations even if an offline
phone cannot unregister. Registration/cleanup are serialized on the client.

Relay authoritative completion/input events via Expo Push/APNs/FCM, not background
WebSockets. Maintain event IDs, bounded retries/deduplication, receipt processing,
inactive-registration expiry, invalid-token cleanup and rate limits. Use generic text;
no code/prompts/paths/secrets/output in push payloads.

```json
{
  "version": 1,
  "eventId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "userId": "authenticated-user-id",
  "machineId": "machine-id",
  "projectId": "33333333-3333-4333-8333-333333333333",
  "sessionId": "66666666-6666-4666-8666-666666666666"
}
```

Client accepts structured IDs, ignores cross-account responses, navigates internally
and re-fetches authorized state. No arbitrary notification URL opens. Daemon attention
remains authoritative. Cross-organization links currently require switching organization.

### Deletion / public pages

Re-authenticate with the password. Define transactional handling of personal/shared
organizations, machine/subscription ownership, jobs and retained billing records before
advertising deletion. Return success only when complete or durably scheduled; revoke
sessions, sockets and push tokens. Publish timing/retention explanations. Client confirms
password plus `DELETE`, then signs out; client code cannot implement cloud deletion.

Publish `https://concors.dev/privacy`, `/support`, `/account/delete` (or update configured
URLs). External deletion must actually accept requests. Publish Apple
`apple-app-site-association` and Android `assetlinks.json` for `/session` using real team
IDs/release fingerprints. This PR deploys none of these pages/association files.

## References reviewed

- Paseo `a7a708bec99e935ee4b8c6f7314a4b9a9984cfa6`: timeline sync, tool presentation,
  terminal WebView readiness and notification routing tests; adapted readiness-before-attach,
  snapshot/live merging and validated navigation.
- Herdr `b99002ac99b09e00b4ca692436cb15a6b0d676f1`: notification policy and attention
  aggregation; retained authoritative attention and device-local focus.

Behavior references only; no upstream source/assets copied. Icons derive from Concors' SVG.
