# Submission packet — not approved for upload

This packet prepares a release; it does not certify store compliance. The evidence
in `readiness.json` remains pending/blocked. No production signing, paid resources,
backend deployment, account deletion, or store upload has been performed.

## Critical path

| Work                 | Owner / decision        | Acceptance                                                                                                                                                                                          |
| -------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First-release scope  | Product                 | Approve existing-account companion versus signup/purchasing; decide whether push ships in v1. Do not silently remove existing features.                                                             |
| Production workspace | Backend                 | Versioned authenticated Concors protocol bridge in the existing machine agent; daemon installation/lifecycle, token expiry and active-socket revocation. Dedicated non-customer acceptance machine. |
| Account lifecycle    | Backend + product       | Password recovery delivery; durable deletion; explicit handling of shared organization ownership, machines, subscriptions and retained records. No client-only deletion.                            |
| Public pages         | Website + privacy owner | Actual privacy/support pages and working deletion request; accurate retention and subprocessors.                                                                                                    |
| App links            | Website + signing owner | JSON association files with the real Apple team ID and Play signing certificate fingerprints.                                                                                                       |
| AI safety            | Backend + privacy owner | Provider disclosure/consent, content safeguards and functioning in-app reporting under applicable store policy. A support email alone is not an in-app report workflow.                             |
| Distribution         | Team account owner      | Verified Apple/Google accounts, Expo project, agreements, app records, signing, reviewer contacts and any Play testing requirement.                                                                 |
| Installed acceptance | Device QA               | Signed physical iPhone/Android tests; permissions, accessibility and a 16 KB Android device.                                                                                                        |

Source audit: `concors-server` main `2f2ea5a` exposes authenticated tmux terminal
sessions, not the Concors workspace/chat protocol. There is no reviewed mobile-device,
deletion or AI-report route. Email auth has no password-reset email delivery configured.
See [backend contract](../../../docs/mobile-backend.md).

Public GET checks on 2026-09-09 returned the same 1,315-byte marketing HTML shell for
`/privacy`, `/support`, `/account/delete`, `/.well-known/apple-app-site-association`
and `/.well-known/assetlinks.json`. Website source has no corresponding policy/request
routes. HTTP 200 alone is not sufficient; association responses must be JSON.

## Listing and screenshots

`store-listing.json` contains draft copy. Approve every claim against the signed candidate
and chosen scope. Do not upload the development demo as the product or use customer data.
Capture the actual candidate with a dedicated review workspace: agent chat and tool call,
tabs/panes, project files/Markdown/code, terminal with harmless output, and sidebar/settings.
Use the sizes currently accepted by [App Store Connect](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
and Play Console. CI screenshots are engineering evidence, not finalized store artwork.

## Review notes draft

Concors is a coding-workspace client. Its app UI, fonts and renderer ship inside the binary.
Agent commands and terminals execute on the connected machine; the app does not download
or execute a new native app on the phone. Chat, files and terminal data arrive through an
authenticated workspace protocol, not screen mirroring.

Provide reviewers a dedicated account and functioning machine throughout review. Enter
credentials privately in the store console, never in a PR or this file. Explain sign-in,
the AI-sharing disclosure, machine selection, a conversation, a harmless tool request,
Files and a harmless terminal command. State account/provider requirements. Do not require
reviewers to join a private developer tailnet to exercise the production app.

Record a storefront assessment of remote execution and commerce; this description does
not guarantee how Apple classifies the app or guarantee approval.

## Data inventory for the privacy owner

This engineering inventory is **not a publishable privacy policy**. Confirm production
collection, purposes, processors, retention, deletion and regional terms before disclosures.

| Data                                                            | Current path/storage                                                          | Needs confirmation                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| Name, email, user/org IDs                                       | Native sign-in → API; account state in memory                                 | Controller, retention, recovery/deletion                |
| Session credential                                              | SecureStore; bearer header to API; never renderer state                       | Production revocation, backups/reinstall                |
| Prompts, replies, tool data, attachments, code, terminal output | Phone ↔ daemon; configured AI provider receives agent input/tool-read content | Provider settings, logs, subprocessors, exact retention |
| AI consent                                                      | Version, account/org or private-endpoint scope, timestamp in SecureStore      | Approved disclosure; native persistence/withdrawal      |
| Preferences/drafts                                              | Device theme/corners/sound; chat/file drafts in memory                        | Data-loss warnings, reinstall                           |
| Push registration                                               | Optional installation ID/Expo token; generic ID-only event routing            | Backend, APNs/FCM/Expo retention, revocation            |
| Attachments                                                     | System document selection; bounded cache read/cleanup                         | Physical picker cancellation/denial, provider retention |
| Billing/deletion                                                | Shared UI and allowlisted API; newer methods explicitly unsupported           | Launch scope, store rules, retained records, ownership  |

No analytics or advertising SDK was intentionally added here. This is **not** a declaration
that the service collects no data. Review Xcode's privacy report for the signed archive;
do not copy SDK-level "no data" declarations into the app's store form.

iOS uses the system document picker and OS keyboard dictation, so unused camera/microphone/
photo-library purpose strings were removed. Android blocks camera, recording and broad
media/storage permissions. CI audits the APK; inspect the final AAB, signing, generated
APKs and 16 KB runtime behavior too. These checks do not grant release approval.

## Evidence and candidate preparation

Choose `releaseModel`. Change a required gate to `verified` only when complete, with
`verifiedBy`, ISO `verifiedAt`, and nonempty `evidence` references. An intentionally omitted
feature needs approved scope plus proof the binary/UI/listing no longer exposes or promises
it. Never use a checked gate to waive policy or leave a broken feature visible. Private
evidence can reference a team record; do not commit credentials or private network addresses.

```bash
# Read-only report; expected exit 1 while blockers remain.
APP_VARIANT=production EXPO_PUBLIC_DEMO=false pnpm --filter @concors/mobile release:check --json
```

After all gates genuinely pass, use [the release runbook](../../../docs/mobile-release.md)
for team-signed TestFlight/Play internal candidates. Internal upload is not review submission
or publication. Obtain release-owner approval before submitting for review or public release.

## Policy references checked 2026-09-09

- [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/): reviewer access, commerce, remote execution and explicit third-party AI permission.
- [Apple upload requirements](https://developer.apple.com/news/upcoming-requirements/): Xcode 26 / iOS 26 SDK minimum and updated age-rating questionnaire.
- [Google target API](https://support.google.com/googleplay/android-developer/answer/11926878): API 36 for new phone apps/updates under the current requirement.
- [Android 16 KB compatibility](https://developer.android.com/guide/practices/page-sizes): packaging, ELF alignment and runtime.
- [Google AI guidance](https://support.google.com/googleplay/android-developer/answer/14094294) and [developer policy](https://support.google.com/googleplay/android-developer/answer/16329168): assess safeguards/reporting; do not assume coding chat is exempt.
- [Apple deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/) and [Google deletion](https://support.google.com/googleplay/android-developer/answer/13327111).
- [Expo privacy manifests](https://docs.expo.dev/guides/apple-privacy/): inspect app/dependency declarations in the archive.
