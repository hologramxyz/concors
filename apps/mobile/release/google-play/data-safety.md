# Google Play data safety preparation

Prepared November 10 and updated November 12, 2026 for `xyz.hologram.concors`. Google accepted the
updated CSV through its Data safety API on November 12. This is an accepted write, not policy
approval or a complete readback of the Console's App content forms. The uploaded Android build
0.1.0 (3) and its configured Firebase identity have been audited; see [upload evidence](play-upload-2026-11-12.json).

[The importable CSV draft](data-safety-draft.csv) uses Google's linked sample template and discloses
possible AI/tool sharing of message, attachment, file and other supplied content. It does not rely
on an unverified sharing exception. [Its preparation record](data-safety-draft.json) identifies the
template and selected categories. Google's public sample omitted required account-creation and
deletion questions. The submitted CSV now includes API-validated responses for email-identifier
plus one-time-code authentication, OAuth and `https://concors.dev/account/delete`. The obsolete
`PSL_DATA_COLLECTION_USER_REQUEST_DELETE` row was removed. No separate partial-data-deletion
workflow without account deletion is advertised, so that optional capability is answered **No**;
this does not remove the implemented account-deletion pathway. All eleven original data-category
and handling disclosures are preserved. A successful write does not complete other App content
declarations or establish Google policy approval.

## Collection and security

The app collects user data. Network connections use HTTPS/WSS; this is transport encryption,
not a claim that every intermediary is unable to read content. Accounts can be created through
normal Privy sign-in. Account deletion is available in Settings → Account → Delete my account
and externally at <https://concors.dev/account/delete>. Do not select "no account creation".

| Google data category                         | Data used by Concors                                                   | Purpose and optionality                                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal info: name, email address, user IDs | Provider identity, email, account/session and organization identifiers | Account management, app functionality, security; identifiers/email are required for accounts and names depend on the selected sign-in provider |
| Messages: other in-app messages              | Agent prompts, answers and conversation content                        | App functionality; supplied when using conversations                                                                                           |
| Photos and videos                            | Attachments the user explicitly selects                                | App functionality; optional                                                                                                                    |
| Files and docs                               | Selected files, code, terminal/workspace content and tool context      | App functionality; optional according to the work requested                                                                                    |
| App activity: other user-generated content   | Plans, instructions and optional support/content reports               | App functionality and developer communications; reports are optional                                                                           |
| App activity: app interactions               | Privy initialization and successful authentication events              | Authentication/service analytics and app functionality; sign-in SDK behavior                                                                   |
| App info and performance: diagnostics        | Request/error records and session device/browser information           | App functionality, security and service diagnostics                                                                                            |
| Device or other IDs                          | Privy browser identifier, app installation identifier and push tokens  | Sign-in analytics/security; optional push delivery and account management                                                                      |

Content retained on a connected machine is not anonymous or ephemeral merely because it is outside
the account database. The API gateway, machine, AI provider and configured tools can receive
content needed for the requested work. Avoid declaring all AI requests "processed ephemerally".

Android dictation uses the user's keyboard. Concors receives text, not an Android microphone
recording. The Android config blocks microphone, camera, broad media and external-storage
permissions; verify their absence in the signed artifact. Photo/file selection still counts as
collection when the user sends that attachment off the device.

## Sharing

Map each transfer using Google's definitions. Processors acting only on Concors's behalf may
qualify for the service-provider exception. User-directed transfers to a named, configured AI/tool
service may qualify for the user-initiated sharing exception only when the actual disclosure and
consent meet Google's criteria. Do not assume that all custom destinations are service providers
or declare "no sharing" solely because the user owns the connected machine. If an exception cannot
be substantiated, disclose the affected message, file and attachment categories as shared.

Optional Android push adds Expo and Google Firebase Cloud Messaging to the delivery path. The
payload contains generic status, machine name and navigation identifiers, not conversation/code
content. Register Android with Firebase without enabling extra analytics or crash reporting.
Reassess this form if any such service is introduced.

No advertising, sale of personal information or advertising SDK is in the launch scope. Privy's
sign-in diagnostics are still analytics. User/account IDs, device IDs and sign-in interactions
cannot be omitted just because Concors has no separate product analytics SDK.

## Retention and sources

Keep the live [privacy policy](https://concors.dev/privacy),
[existing provider/source inventory](../privacy-disclosures.md) and these answers aligned. The
policy describes account deletion, independent machine/provider records, 30-day resolved-report
cleanup, the operational log access window and the limits of the observed backup settings. It
does not promise physical log erasure after 30 days.

Primary references:

- [Google data safety definitions and exceptions](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Google account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Expo Android push configuration](https://docs.expo.dev/push-notifications/fcm-credentials/)

Private reviewer credentials, account sessions and service-account JSON files belong in the
private release workspace/console credential fields, never this repository.
