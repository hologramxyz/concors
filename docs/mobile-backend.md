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
- [The daemon installer change](https://github.com/hologramxyz/concors-server/commit/f8d03539d726b3cbc45bb2ca46e5e09ea6719171) replaces the
  legacy tmux agent with the daemon release and is merged into server main (`f8d0353`).
  A merged installer is not proof that the updated artifact is deployed to a machine.
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
desktop. The native host checks AI-sharing permission before applicable agent/provider/schedule requests.
Files and local message indexes remain readable; interrupt/decline/cancel actions stay available.
Opening a conversation can resume its provider, so history/attachment/child-history requests are also guarded. Grants are
scoped to the current account/machine connection, provider registry revision and selected model.
Settings → Account can withdraw permission. Authentication and private direct-endpoint authorization
remain required. Provider data/retention facts still need owner verification.

## Verification and release gates

The read-only `pnpm --filter @concors/mobile live:preflight` checks the same managed
metadata and discovery. It does not create a session or prove live/native acceptance.
Credentials belong in private local/CI environment variables, never public Expo vars.

Before claiming production acceptance: deploy the merged installer/client changes,
publish the updated daemon artifact, install on a non-customer test machine, and prove
desktop/phone concurrency, token expiry/revocation, files, chat approvals and
background/reconnect on signed native builds. No deployment, fleet update, signing,
store submission or physical-device verification is implied by these source tests.

## Account and optional services

The account API now implements durable deletion and private content reports. Deploy the server
migrations before clients. `accountDeletionFlow: "reauth-plan-v1"` advertises the new flow;
legacy `accountDeletion` remains false to keep password-only clients from offering it.

| Route                                  | Request                                                               | Result                                                     |
| -------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| `GET /api/v1/mobile/capabilities`      | authenticated                                                         | Version 1, managed access, no push, deletion flow marker   |
| `GET /api/v1/account/deletion`         | authenticated                                                         | Plan, affected organizations/machines, ownership transfers |
| `POST /api/v1/account/deletion`        | `{confirmation:"DELETE",planToken}` and fresh same-user sign-in       | Durable job and private status receipt                     |
| `POST /api/v1/account/deletion/status` | `{receipt}`                                                           | Processing/completed status, no account data               |
| `POST /api/v1/support/reports`         | category, user-written message, optional authorized machine reference | Private report reference                                   |

The API revokes all account sessions, disables owned-machine credentials and retries provider cleanup.
Owned cloud disks are rebuilt and subscriptions stopped; the user's own external computers are not
wiped. Shared teams and colleagues' machines remain. Cleanup revokes Apple OAuth and removes Privy
identities before final DB deletion. Reports are rate limited, removed with the account or purged
30 days after resolution. The server README documents operator triage and delayed-job monitoring.

Push is built but off until the control plane sets `PUSH_NOTIFICATIONS=true` (see Push below);
until then `pushNotifications` stays `false` and the app keeps its switch disabled.

### Push

`installationId` is a device UUID; `token` is an Expo push token. Derive ownership from
the authenticated session, never a client user ID. Registration is idempotent; account
switches atomically reassign/revoke ownership. Unregister is idempotent and rejects
cross-user deletion. Session/account revocation removes registrations even if an offline
phone cannot unregister. Registration/cleanup are serialized on the client.

How it works now: a cloud or connected machine's gateway follows its session host's chats
(`packages/daemon/src/managed/attention.ts`) and, when one goes from working to done, needs
input or failed, posts `{ eventId, kind, projectId, sessionId, userId? }` to
`POST /api/v1/agent/attention` with its machine credential, retrying three times with the same
`eventId`. `userId` is whoever last sent, steered or queued a prompt in that chat through this
gateway; without one (a schedule, or a prompt from before the gateway restarted) the control
plane notifies the machine's creator. The control plane sends through Expo; see
concors-server `docs/push-notifications.md`. The desktop app's own local daemon has no machine
credential and reports nothing.

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

### Public pages and authentication

The website changes provide `/privacy`, `/support`, `/terms` and a self-service `/account/delete`
page with a fixed HTTPS callback and PKCE. The owner selected **gm@hologram.xyz**. Recheck the live
pages and deletion after deployment; local tests alone do not establish production acceptance.
Authentication uses registered app schemes. Unused iOS Universal Links and Android App Links have
been removed instead of declaring unsupported association files.

Sign in with Apple is implemented in API, iPhone and desktop clients, but remains undiscoverable
until the Apple/Privy setup, matching Services ID/client secret, encrypted revocation storage and
private-email relay are configured. See the server's `docs/sign-in.md`. This is separate from the
exposed Expo submission key, which still must be revoked and replaced privately.

## References reviewed

- Herdr `b99002ac99b09e00b4ca692436cb15a6b0d676f1`: notification policy and attention
  aggregation; retained authoritative attention and device-local focus.

Behavior references only; no upstream source/assets copied. Icons derive from Concors' SVG.
