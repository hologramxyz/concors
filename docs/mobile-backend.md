# Mobile backend integration contract

This is a **proposal for Pierre's review**, not a claim that endpoints are deployed.
No `concors-server` implementation is included. Reviewed server revision `50d5a6d`
(clean fast-forward on 2026-09-08) has Better Auth bearer sessions, organizations,
provisioning and machine lifecycle APIs, but no mobile capability, daemon-ticket,
push-device or deletion routes. Client baseline `3bd5e33` already has persistent
workspace, terminal and agent sessions: UI work need not wait for a new daemon.

## Existing contracts reused

Native sign-in/sign-out and `/api/v1/me` use bearer tokens, not browser cookies or a
Vite proxy. Sign-in must supply a token in the body or exposed response header.
Organizations/machines use `@concors/api-client`. Daemon traffic uses Concors v1 through
`DaemonConnection`: epochs, expected versions, stable pane/session IDs, bounded history,
PTY ownership and attach snapshots retain their existing meaning. No protocol fork.

## Proposed additive routes

Authenticate and authorize membership on every request. Use usual `{code,message}`
errors with meaningful HTTP statuses. Schemas/client validation are in
`packages/api-client/src/mobile.ts` and `client.ts`.

| Route                                           | Request                                            | Success body                                                                         |
| ----------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /api/v1/mobile/capabilities`               | —                                                  | `{version:1,remoteAccess:boolean,pushNotifications:boolean,accountDeletion:boolean}` |
| `POST /api/v1/machines/:id/connect`             | `{}`                                               | `{machineId,url,ticket,expiresAt}`                                                   |
| `POST /api/v1/mobile/devices`                   | `{installationId,token,platform:"ios"\|"android"}` | Any successful 2xx body                                                              |
| `DELETE /api/v1/mobile/devices/:installationId` | —                                                  | Any successful 2xx body                                                              |
| `POST /api/v1/account/deletion`                 | `{password}`                                       | `{status:"deleted"\|"scheduled"}`                                                    |

Only a 404 capability response means an unsupported older server. Authentication,
service errors and malformed responses are not silently converted into feature flags.

### Daemon gateway

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
