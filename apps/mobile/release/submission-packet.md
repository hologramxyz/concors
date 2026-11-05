# App Store submission packet — not ready to submit

Reviewed on **2026-11-04 UTC** against the current [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), production endpoints, App Store Connect, and the signed **0.1.0 (7)** IPA. Evaluated source: `aa3a9fddbbbc08994a14868910446f0064f3ed3a`.

The owner confirmed **Concors: Coding Workspace**, reported no prior rejection, and confirmed a **free launch**, with machines added from the desktop app. The app is [`6817622624`](https://appstoreconnect.apple.com/apps/6817622624), bundle `xyz.hologram.concors`, Apple team `9WN4P724M2`. The current build is in internal TestFlight. This review did not submit a public version or certify readiness.

## Remediation prepared on 2026-11-05

The audit below records the original production/TestFlight findings. The remediation branch starts
from updated main `6a1844dc` and adds the following; production/device verification remains separate.

Related changes: [account lifecycle API](https://github.com/hologramxyz/concors-server/pull/21)
and [public pages/browser deletion](https://github.com/hologramxyz/concors-web/pull/12).
The owner selected **gm@hologram.xyz** for public support and privacy contact. The exact legal
company name is still unconfirmed.

| Finding                        | Implemented change                                                                                                                                                | Remaining acceptance                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Missing public pages           | Real privacy/support/terms pages, **gm@hologram.xyz**, and a PKCE-protected web deletion page                                                                     | Verify deployed URLs, mailbox, owner retention/processor facts                     |
| No account deletion            | Native same-user reauthentication, affected-resource plan, durable cleanup/receipt, revocation, owned disk erasure and billing cancellation                       | Signed iPhone and dedicated non-customer live acceptance; monitor delayed jobs     |
| Social login without Apple     | API + iPhone + desktop Apple login, private relay address support, verified encrypted refresh tokens and Apple revocation                                         | Private Apple/Privy Services ID/client secret/relay configuration and device tests |
| AI sharing permission absent   | Native boundary enforces configuration/model/connection permission, including scheduled work and tool responses; decline/withdrawal stops new applicable requests | Verify actual custom recipients and provider terms; physical-device acceptance     |
| Content reporting absent       | In-app private report form, authorized API, rate limiting, operator triage and bounded resolved-report retention                                                  | Run the moderation/support process and confirm applicable safety rules             |
| Unsupported associated domains | Remove unused production Universal/App Link declarations; retain supported authentication schemes                                                                 | New signed build and actual sign-in/link acceptance                                |
| Stale release scope            | Record free launch with desktop machine setup and account creation through normal sign-in                                                                         | Countries, age ratings, privacy labels and public version/build alignment          |

The existing `readiness.json` gates remain pending/blocked; implementation is not signed-device or
store-console approval. No new TestFlight upload or App Review submission is claimed. A new signed
candidate must replace `0.1.0 (7)` before the new behavior can be reviewed by Apple.

Local remediation checks passed: formatting, lint, full TypeScript checks and **1,668 workspace
tests** (two skipped), including the new protocol permission and same-user reauthentication cases.
The API passed **517 tests** (13 skipped), including disposable-Postgres lifecycle/concurrency
tests. Website build/format checks, four static-server/changelog tests and **20 browser checks**
passed; seven mobile workspace browser smoke checks also passed. Rust checks could not run locally
because Cargo is not installed. These checks do not establish signed iPhone acceptance.

## App Store fields completed before remediation

The verified iOS draft is exported in [`app-store-connect-draft.json`](app-store-connect-draft.json). `store-listing.json` remains the earlier generic cross-platform draft; use the verified export for current iOS copy.

| Field                                              | Current state                                               |
| -------------------------------------------------- | ----------------------------------------------------------- |
| Name                                               | Concors: Coding Workspace, retained as requested            |
| Subtitle                                           | Code, agents and terminals                                  |
| Primary category                                   | Developer Tools                                             |
| Description, keywords, promotional text            | Filled from implemented features and read back from Apple   |
| Marketing URL                                      | `https://concors.dev/`, reachable                           |
| Review notes                                       | Filled with architecture, requirements and navigation steps |
| Review-account-required flag                       | Enabled; actual login details still missing                 |
| iOS draft                                          | Version `1.0`, PREPARE_FOR_SUBMISSION                       |
| Available binary                                   | TestFlight `0.1.0 (7)`; no build attached to version `1.0`  |
| Screenshots                                        | None uploaded                                               |
| Support/privacy URLs                               | Empty in Apple; configured destinations return 404          |
| Age rating                                         | Questionnaire unanswered                                    |
| App Privacy labels                                 | Not verified through available API; console review needed   |
| Copyright, content rights, review contact          | Owner information needed                                    |
| Pricing, territories, agreements, EU trader status | Not changed or certified                                    |

The existing release type is **AFTER_APPROVAL**. Choose intended release timing before eventual submission. Reviewer credentials belong only in Apple's private fields.

The owner confirmed the launch model after the verified Apple writes. `pendingDraftUpdates` in the export contains the prepared description/review-note clarification: launch is free, machines are added on desktop, and reviewers receive an already connected machine. These additions have **not** been uploaded to Apple. Store pricing and launch countries also remain unverified.

### Submission credential replacement

Expo currently assigns the only saved organization submission key, named **Heist EAS Submit**, to the Concors project. The owner confirmed Heist is unrelated. The Apple app identity above is correct; no Heist app was modified. A private key was accidentally exposed in diagnostic output during this review. Saved diagnostics were sanitized, but that does not invalidate the exposed key. Its owner must revoke it in App Store Connect, and a dedicated Concors key must replace the Expo assignment before further Apple uploads or metadata writes. No key was revoked or replaced during this review.

## Confirmed implementation gaps

### Public pages and links

Public GET checks on 2026-11-04 returned **404 Not found** for `https://concors.dev/privacy`, `/support`, `/account/delete`, `/terms`, and `/.well-known/apple-app-site-association`.

The first three are configured in `src/config.ts`; account settings link to privacy and support. Publish accurate privacy/support content and a functioning deletion flow, then test rendered pages and forms. A terms page is useful for the service; the missing terms URL is not described here as a universal standalone Apple requirement. See [Apple's privacy information instructions](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/).

The missing association file is a separate engineering issue: production declares Universal Links. Current native authentication uses a custom URL scheme, so the 404 does not by itself prove sign-in is broken. Fix/test Universal Links or remove that unsupported declaration from release scope.

### Account creation and deletion

`src/auth/sign-in-choices.tsx` explicitly tells new users that continuing creates an account. The native API request does not restrict sign-in to existing accounts; server `modules/auth/accounts.ts` can create a user and personal organization. The historical existing-account-only description is therefore incomplete.

Production `/api/v1/native-auth/providers` returns GitHub, Google and email enabled. `/api/v1/mobile/capabilities` returns route-not-found 404. The API client maps that response to disabled optional capabilities, so account settings show deletion unavailable. This combines public observations with the client fallback; no destructive request was made.

Implement durable deletion, reauthentication and session revocation, including shared organization/machine ownership, subscriptions and retained records. The existing deletion form asks for a password although current Privy social/email-code users may have none. The flow must support those accounts. See [Apple's account-deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion). Emailing support is not the intended deletion mechanism for this ordinary developer service.

### Version, screenshots and reviewer access

The App Store draft is version `1.0`; the tested IPA is `0.1.0 (7)`. Align the public version, binary and readiness evidence after the product fixes. No screenshot sets or build are attached to the iOS draft.

Capture the actual native app with a dedicated workspace: agent conversation/tool request, sub-agent progress, files, terminal and workspace navigation. Use fictional data, never customer code or credentials. Browser/demo captures do not establish the native glass UI. Apple's [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) include accepted 6.9-inch images such as 1320 × 2868 or 1290 × 2796, without transparency.

Review contact and account fields are empty. Provide a non-customer account, accessible live machine and functioning provider access throughout review. Current sign-in uses social login or email codes; an invented password in Apple's form will not work. Resolve independent access without the owner forwarding fresh OTP codes. Do not add a global authentication bypass or replace production with the engineering demo. See [Apple's complete-review instructions](https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review/).

## Policy assessments requiring decisions

These are assessments, not predictions of a specific rejection. Numbered references are to the [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

| Area                                       | Current evidence and recommended action                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login — 4.8                                | GitHub/Google authenticate the primary account; no Apple/equivalent private-email option is exposed. Add an equivalent option, normally Sign in with Apple, or establish a documented exception. Email OTP alone does not establish private-email creation.                                                                      |
| AI sharing — 5.1.2(i)                      | Prompts, code, tool context and attachments can reach configured providers. The earlier separate consent gate was removed. Define recipients/data and obtain explicit permission before sharing personal data with external AI. A model-picker label does not establish permission.                                              |
| AI content — 1.2 / possibly 4.7            | Generated content and shared workspaces are exposed; no functioning content-report workflow was found. Determine applicable safeguards/reporting and response handling. User blocking depends on actual user-to-user features; do not invent a social-network classification.                                                    |
| Commerce — 3.1                             | Owner confirmed launch is free, with machines added on desktop; mobile hides/rejects purchasing, provisioning and billing. Verify there is no required paid Concors entitlement for launch. Assess separate AI-provider requirements and the 3.1.3(f) companion rationale where applicable; launch countries remain unconfirmed. |
| Remote functionality — 2.5.2 / 4.2 / 4.2.7 | Bundled UI exchanges structured workspace data; it is not streamed host-screen mirroring. Explain and demonstrate that architecture. Apple decides the classification; do not assume arbitrary cloud thin clients are allowed.                                                                                                   |
| Software offered inside the app — 4.7      | No app marketplace or remote feature bundle was identified, but coding agents expose AI/chatbot functions. Assess the actual offered software before claiming all or none of 4.7 applies.                                                                                                                                        |

If the remote-workspace/commerce classification remains uncertain after factual fixes, consider an App Review appointment through [App Review help](https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review/).

## Privacy and age-rating worksheet

No analytics or advertising SDK was intentionally added to mobile. That does not establish that the service or authentication provider collects no data.

| Data                                                   | Observed path                                                              | Owner confirmation needed                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Name, email, user/org IDs                              | Privy and Concors account service                                          | Controller, processors, retention and linked functionality disclosures |
| Session/network information                            | Server session creation records IP/user agent; mobile uses SecureStore     | Logs, retention, access and revocation                                 |
| Prompts, responses, code, terminal output, attachments | Connected daemon and configured AI providers; machine conversation history | Downstream storage/training settings, linkage and deletion             |
| Selected photos/videos/files                           | Picker and message attachments                                             | Cache cleanup and downstream retention                                 |
| Dictation audio                                        | Host relay to machine transcription                                        | Actual retention before applying any real-time-processing exclusion    |
| Push/device tokens                                     | Push is disabled by current production capability fallback                 | Reassess if enabled; no delivery claim                                 |

[App Privacy details](https://developer.apple.com/app-store/app-privacy-details/) cover collection beyond real-time processing. Do not derive service-wide answers from SDK manifests alone. The available API rejected privacy-label relationships; the current label state remains unverified, rather than known empty.

Age-rating responses are empty. Assess AI output, accessible files and shared content using the [age-rating definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/). Messaging/chat there concerns user-to-user communication; AI chat alone does not establish that checkbox. Do not automatically answer every content question None or select 4+ from the developer-tool category.

## Binary and test evidence

Inspected `0.1.0 (7)`: store provisioning, team `9WN4P724M2`, iPhone device family, minimum iOS 16.4, Xcode 26.6 / iPhoneOS 26.5 SDK, approved API and source revision embedded. Microphone and selected-photo purpose text is present; camera/tracking purpose strings and background modes are absent. `EXUpdatesEnabled=false` supports the bundled-renderer description.

Twelve privacy manifests were found, including the app's merged manifest. Recorded API-reason categories are file timestamps, user defaults and system boot time. They declare no tracking; that is binary evidence, not a backend/provider declaration. See [Apple's SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/).

The release passed 1,602 workspace tests, with two skipped; formatting, lint and type checks passed. Seven browser checks passed across the initial run and timeout rerun documented in `docs/mobile-testflight.md`. Record actual iPhone/iOS versions and sign-in, upgrade, microphone allow/deny, files, keyboard, background/reconnect, tool approvals and accessibility before signoff. Those physical-device results were not established in this review.

## Guideline coverage and platform scope

| Section         | Review scope                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Safety      | AI/UGC handling, support contact and security. No proposed Kids Category, medical, gambling or physical-harm feature.                                       |
| 2 — Performance | Completeness, metadata, screenshots, age rating, bundled UI/code, network/device behavior, microphone/files. Native acceptance remains incomplete.          |
| 3 — Business    | Billing/provisioning exclusions, paid external services, storefront differences and companion classification.                                               |
| 4 — Design      | Native utility, remote-client classification, possible 4.7 applicability, login and optional push. No keyboard extension, Game Center or Apple Pay feature. |
| 5 — Legal       | Privacy, deletion, provider handling, content/IP rights and developer identity. Owner/legal facts remain outstanding.                                       |

The Apple record also has a macOS `1.0` draft without a build. The desktop DMG uses `dev.concors.desktop`; its Tauri config enables `macOSPrivateApi`. Mac App Store sandboxing, public APIs, local runtime/CLI installation and updates need a separate assessment. iPhone TestFlight acceptance does not cover a Mac App Store submission.

## Information needed from the owner

1. Launch countries and legal copyright holder. Public support/privacy contact is **gm@hologram.xyz**; verify the inbox is monitored. Launch is confirmed free, with machines added from desktop. Apple signing organization Rolling Inc. is not proof of the copyright owner.
2. Approved processor, retention/deletion and AI handling/training facts; intended audience/minimum age and third-party content/service rights.
3. Review contact name/email/phone and durable dedicated account/machine access. Enter credentials privately in App Store Connect, never in this repository.
4. Native iPhone screenshots and final physical-device acceptance results.
5. Account-holder verification of agreements and, for EU launch, accurate [DSA trader information](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/).

## Route to submission

Replace the exposed submission credential. Fix public pages, deletion/reauthentication, login and AI disclosure/reporting decisions. Confirm the commerce/remote rationale and owner facts; provide working review access, screenshots and device evidence. Then choose the public version, build/inspect the corrected iOS candidate, complete declarations and attach the matching build before submission.

`readiness.json` remains unverified. The production checker returns exit 1 and includes Android/Play gates alongside real iOS gaps. Google/Android gates are repository workflow requirements, not Apple requirements. Define an honest iOS signoff path rather than marking unrelated requirements verified. Follow `docs/mobile-release.md`; do not bypass the gate.
