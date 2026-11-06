# iOS privacy disclosures

Reviewed November 6, 2026. This is the source-backed baseline for the iPhone app's native privacy
manifest and the App Store Connect disclosure draft. Publication still needs confirmation of the
production processors, security-log/backup retention and provider data uses. These declarations do
not certify a custom AI provider's practices.

Apple requires the app's own collection to be described in its
[privacy manifest](https://developer.apple.com/documentation/technotes/tn3184-adding-data-collection-details-to-your-privacy-manifest).
The signed build 10 manifest had no collected data types; it declared the SDK required-reason APIs
and no tracking. The next binary must include the collection declarations in `app.config.ts` and
retain the SDK required-reason entries. App Store privacy labels are a separate declaration.

| Apple data type       | Why it is collected                                                                                        | Source evidence                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Name                  | Account identity, including names supplied by sign-in providers                                            | Server `src/modules/auth/privy.ts`, `accounts.ts`, `src/db/schema/auth.ts`    |
| Email address         | Sign-in, account identity and recovery                                                                     | Server account/auth modules; `apps/mobile/src/auth/sign-in.ts`                |
| User ID               | Sessions, organization membership and access to machines                                                   | Server `src/modules/auth/sessions.ts`, `src/db/schema/auth.ts`                |
| Other user content    | Prompts, code, files, scheduled instructions and terminal/workspace history retained on connected machines | `packages/daemon/src/`, mobile workspace host and file/agent/schedule UI      |
| Photos or videos      | User-selected attachments retained with work and potentially passed to configured AI providers             | `apps/mobile/src/workspace/native-chrome.ios.tsx`, daemon attachment handling |
| Customer support      | Optional user-written reports linked to the reporting account and selected machine                         | Server `src/modules/support/`, mobile support form                            |
| Other diagnostic data | Session IP address/user agent and server request/error records used for security and operation             | Server `src/modules/auth/sessions.ts`, `src/lib/logger.ts`, `src/app.ts`      |

For this baseline, all seven types are **linked to the user**, used for **app functionality**, and
**not used for tracking**. Authenticated machine access does not make retained content anonymous.
Reporting is disclosed even though it is optional. The user sees and grants AI sharing separately.

Dictation audio goes to the connected machine's local transcription model, stays in memory during
the request, and is not retained as a recording by this implementation. The resulting text follows
the ordinary workspace-content path. This real-time processing is distinct from collecting retained
audio under [Apple's collection definition](https://developer.apple.com/app-store/app-privacy-details/).
Reassess Audio Data if recording, logging or a remote transcription provider is introduced.

The current production API does not advertise push support, so the iPhone app hides enrollment.
The client contains a future push-registration path; before enabling it, disclose retained
installation/push identifiers as Device ID and validate registration, delivery and revocation.
There is no iPhone checkout; desktop billing records must be assessed separately if later collected
through the phone. Browser authentication uses Privy and must be included in the provider review.

Before publishing the labels, confirm that the production deployment has no additional analytics,
advertising, crash upload or provider purposes. Verify the production service's actual retention,
all subprocessors and any custom model/tool destinations. Add any additional data types or purposes
to both declarations, then inspect the newly signed IPA rather than relying only on this source.
