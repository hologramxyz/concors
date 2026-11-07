# iOS privacy disclosures

Reviewed November 7, 2026. This is the source-backed baseline for the iPhone app's native privacy
manifest and the App Store Connect disclosure draft. The owner confirmed no additional production analytics, advertising or crash-reporting services.
Production Railway and Privy settings were inspected on November 6. These declarations do not
certify a custom AI provider's practices.

Apple requires the app's own collection to be described in its
[privacy manifest](https://developer.apple.com/documentation/technotes/tn3184-adding-data-collection-details-to-your-privacy-manifest).
[Signed build 12](ios-build-12.json) contains all nine collected data types below, including the
browser identifier and interactions used by Privy sign-in analytics. It preserves the SDK
required-reason entries and declares no tracking. The separate App Store privacy labels are
published with these nine categories and their functionality/analytics purposes.

| Apple data type       | Why it is collected                                                                                        | Source evidence                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Name                  | Account identity, including names supplied by sign-in providers                                            | Server `src/modules/auth/privy.ts`, `accounts.ts`, `src/db/schema/auth.ts`              |
| Email address         | Sign-in, account identity and recovery                                                                     | Server account/auth modules; `apps/mobile/src/auth/sign-in.ts`                          |
| User ID               | Sessions, organization membership and access to machines                                                   | Server `src/modules/auth/sessions.ts`, `src/db/schema/auth.ts`                          |
| Device ID             | Privy browser identifier plus installation IDs/push tokens for optional account-linked notifications       | Privy `privy-ca-id`; mobile `platform/notifications.ts`; server `src/db/schema/push.ts` |
| Product interaction   | Privy SDK initialization and successful sign-in method/new-user events                                     | SDK `sdk_initialize` and `sdk_authenticate` events                                      |
| Other user content    | Prompts, code, files, scheduled instructions and terminal/workspace history retained on connected machines | `packages/daemon/src/`, mobile workspace host and file/agent/schedule UI                |
| Photos or videos      | User-selected attachments retained with work and potentially passed to configured AI providers             | `apps/mobile/src/workspace/native-chrome.ios.tsx`, daemon attachment handling           |
| Customer support      | Optional user-written reports linked to the reporting account and selected machine                         | Server `src/modules/support/`, mobile support form                                      |
| Other diagnostic data | Session IP address/user agent and server request/error records used for security and operation             | Server `src/modules/auth/sessions.ts`, `src/lib/logger.ts`, `src/app.ts`                |

All nine types are **linked to the user**, used for **app functionality**, and **not used for tracking**.
User ID, Device ID, Product Interaction and Other Diagnostic Data also declare **analytics** for
Privy's authenticated browser sign-in events. The SDK sends the browser identifier with API requests,
including authenticated requests; treating that identifier as unlinked would be misleading.
Authenticated machine access does not make retained content anonymous.
Reporting is disclosed even though it is optional. The user sees and grants AI sharing separately.

Dictation audio goes to the connected machine's local transcription model, stays in memory during
the request, and is not retained as a recording by this implementation. The resulting text follows
the ordinary workspace-content path. This real-time processing is distinct from collecting retained
audio under [Apple's collection definition](https://developer.apple.com/app-store/app-privacy-details/).
Reassess Audio Data if recording, logging or a remote transcription provider is introduced.

Optional iPhone push is now in the requested release scope. Before enabling the server flag,
[website PR 16](https://github.com/hologramxyz/concors-web/pull/16) discloses retained installation
identifiers/push tokens linked to the account and sign-in session, with Expo and Apple as delivery
providers. The existing linked Device ID / app functionality disclosure covers these identifiers;
its analytics purpose remains required for Privy sign-in, not push analytics. Push payloads contain
generic agent status, the machine name and account/machine/project/chat/event IDs to open the chat;
no prompt, response, code, file path or tool output is sent. Machine names may appear on the lock
screen. Registrations are removed when disabled in-app, their session is revoked, the account is
deleted, or an invalid token is detected; device-permission withdrawal is reconciled on the next
app foreground check. Event/machine IDs are retained for about one day with hourly cleanup.
Registration, physical delivery, tap navigation and revocation still require the acceptance in
[ios-push-acceptance.md](ios-push-acceptance.md). A build or Expo ticket alone does not prove delivery.

There is no iPhone checkout; desktop billing records must be assessed separately if later collected
through the phone. Browser authentication uses Privy; disabling wallet creation does not disable its
sign-in diagnostics. SDK source confirms a persistent browser identifier, initialization events and
authentication events; [Privy's policy](https://www.privy.io/privacy-policy) describes service analytics
and device/browser/IP data. No advertising or cross-app tracking is claimed by this integration.

The verified Railway production workspace is Pro with a 30-day operational log history limit. Its
two production Postgres volume instances have no backup schedules or retained snapshots. A log
history access limit is not a verified physical erasure deadline: Railway documents that upgrading
can restore previously inaccessible logs. The public policy states this limitation and does not
apply the database observation to independently managed machines or provider records. Resolved
in-app reports expire after 30 days and account deletion removes account-linked reports sooner.

Sources: [Railway log history](https://docs.railway.com/observability/logs),
[Railway backups](https://docs.railway.com/volumes/backups), production settings readback and the
server support-retention implementation. Reassess declarations when adding a processor, remote
transcription, push, billing or custom model/tool destination. Inspect each newly signed IPA.
