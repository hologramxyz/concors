# Mobile backend integration contract

## Implemented client contract (2026-09-10)

Mobile is an **existing-account companion** for v1. It has sign-in and access to
existing machines, but no signup, machine purchasing, subscription management, or
billing links. Commerce RPCs are rejected at the native host boundary, not merely
hidden. The desktop product keeps its existing commerce features.

The authoritative architecture is [managed machines v1](managed-machines-v1.md):
one Concors daemon, with TLS/JWT authentication in its managed gateway and persistent
sessions in its private loopback host. No second terminal-agent bridge is needed.

- Desktop main includes managed mode and Linux release packaging. The published
  `daemon-v0.2.0` predates the active-socket expiry hardening in this mobile PR.
  A new reviewed daemon release and rollout are required before claiming the
  documented revocation window.
- [Server PR #1](https://github.com/concors-dev/concors-server/pull/1) replaces the
  legacy tmux agent with the daemon release. It is a dependency, not duplicated here.
- Optional mobile capabilities control push and account deletion. Managed workspace access
  uses contracts 4.2 and 4.6 directly and does not depend on capability discovery.
- Mobile now uses the existing `POST /api/v1/machines/:id/token` endpoint and
  `wss://<machine.hostname>/ws`. The obsolete `/connect` ticket proposal is not
  used; do not implement another exchange service for this client.

## Connection and identity

Desktop and mobile share `HostSchema`, `machineHost` and `machineAvailability` in
`@concors/client-core`. Profiles contain `machineId`, `label`, `connections` and
`preferredConnectionId`; native device storage scopes profiles to the account and
organization. Discovery comes from `GET /api/v1/machines`, refreshed every 15 seconds.
A machine is connectable when running, with a hostname and a heartbeat no older than
90 seconds. The host rechecks the current account, organization and selected machine
before minting, and rebuilds the URL from the current API hostname.

Machine JWTs are minted with `mintMachineToken` immediately before connecting, saved
in device-only SecureStore, then passed as `Sec-WebSocket-Protocol: concors.bearer.<token>`.
They never enter renderer state, profiles, logs or URLs. The browser preview uses memory
because it has no native secure store. Disconnect/background, machine/account changes,
and sign-out cancel pending mints and clear the saved credential; new connections always
mint afresh. Serialized storage writes prevent a late mint from restoring cleared access.
The account session also uses SecureStore.

HTTP 401 or WebSocket close 4401 triggers one immediate re-mint. Another authorization
failure shows **Access revoked** and stops automatic retries, including foreground/network
transitions. Explicit Retry starts a new attempt. Successful authentication resets the
budget for a later token-expiry episode. Browsers hide failed-upgrade HTTP status; after
one refresh, an opaque failure reports that the machine may be offline or access revoked.
403/404 stops immediately; ordinary network failures use backoff.

The **cloud machine ID** is the control-plane record and JWT audience. The
**workspace machine ID** is an independently generated, persistent daemon namespace.
They need not match. TLS hostname and machine-scoped JWT authentication establish
the remote host identity; workspace epochs/versions scope protocol operations.
Do not compare a workspace namespace with a cloud record ID to authorize access.

Revocation is bounded, not immediate: an already-issued token may work until its
expiry. The server's token route rechecks account-session and organization membership.
A release must verify actual logout and membership removal with an open connection.

## Direct desktop testing remains separate

Preview-only direct mode connects to the existing desktop daemon through an explicitly
configured private WSS endpoint, without a fabricated cloud account. The loopback-only
Tailscale identity/origin adapter is for private testing; it is not production auth.
See [direct setup](../apps/mobile/README.md#first-connect-to-the-same-daemon-as-desktop).

Files use the same schema-validated `file.request`/`file.result` protocol. The daemon
must advertise `project-files`, and `project-file-create` for creation. Chat, tool
events, approvals, tabs/panes, file guards and terminal ownership remain shared with
desktop. Real connections require explicit account/direct-endpoint-scoped AI consent.

## Verification and release gates

The read-only `pnpm --filter @concors/mobile live:preflight` checks the same managed
metadata and discovery. It does not create a session or prove live/native acceptance.
Credentials belong in private local/CI environment variables, never public Expo vars.

Before enabling managed access: review/merge the installer and client/daemon changes,
publish the updated daemon artifact, install on a non-customer test machine, and prove
desktop/phone concurrency, token expiry/revocation, files, chat approvals and
background/reconnect on signed native builds. No deployment, fleet update, signing,
store submission or physical-device verification is implied by these source tests.

## Remaining backend services

Authenticate and authorize every request. Capability discovery governs these optional services only; machine access is authorized
by the token endpoint and managed gateway.

| Route                                           | Request                           | Success                                                      |
| ----------------------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| `GET /api/v1/mobile/capabilities`               | —                                 | `{version:1,remoteAccess,pushNotifications,accountDeletion}` |
| `POST /api/v1/mobile/devices`                   | `{installationId,token,platform}` | Successful 2xx                                               |
| `DELETE /api/v1/mobile/devices/:installationId` | —                                 | Successful 2xx                                               |
| `POST /api/v1/account/deletion`                 | `{password}`                      | `{status:"deleted"                                           | "scheduled"}` |

Only discovery is implemented in the companion server PR. The following push and
deletion contracts still require backend implementation and policy review.

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
