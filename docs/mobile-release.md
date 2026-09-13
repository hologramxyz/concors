# Mobile release runbook

## Shortest path

Start with the [submission packet](../apps/mobile/release/submission-packet.md): draft
store copy, data inventory, public URL audit, and ownership for each blocker. The first
release's existing-account companion scope is approved and enforced in the client. The AI
data-sharing onboarding page and withdrawal controls have been removed by product direction,
without a replacement prompt. Provider/privacy review and content-reporting readiness remain
unverified release gates; removing the page does not establish store compliance.

Client/demo/shared lifecycle/protocol integration/build profiles are implemented.
No signed IPA/AAB, store release or production validation is implied by bundle export.
Test the real workspace now using the [direct desktop connection](../apps/mobile/README.md#first-connect-to-the-same-daemon-as-desktop).
It reuses the existing daemon over a private tunnel without a cloud login or server PR.
Prepare team-owned Expo/Apple/Google accounts in parallel. Managed cloud access requires
the [managed daemon rollout](mobile-backend.md); capability discovery is optional.

## Next implementation slices

1. **Selector polish (client):** tab/pane and machine bottom drawers are implemented;
   choose a pane to navigate, and keep the sidebar open when choosing a machine.
2. **Direct live workspace (client PR):** connect the phone to the same desktop daemon
   through the restricted private tunnel. Test shared IDs, chat/tool history, approvals,
   terminal input and reconnects. The preview-only direct mode is implemented; cloud
   login and a fake inventory entry are not required. Defer the login/empty-state design.
3. **Managed cloud workspace:** the mobile transport now uses `/machines/:id/token`
   and the managed daemon's `/ws` bearer subprotocol. Server installer PR #1 is merged;
   coordinate a new daemon release containing active-socket expiry enforcement and its
   rollout. Capability discovery gates optional push/deletion, not workspace access.
   The old `/connect` proposal is unused.
4. **Cloud acceptance:** identify a non-customer test account/machine, run
   `pnpm --filter @concors/mobile live:preflight`, then prove that desktop and phone see
   the same real project, tabs, agent history and tool events. Test send, approval,
   interrupt and terminal input, plus background/reconnect without duplicate commands.
   Preflight itself is read-only and cannot satisfy this acceptance.
5. **Installed previews, in parallel:** link team Expo/Apple/Google accounts, produce
   signed preview builds, and execute the device matrix below. Safari demo success
   is not evidence of native WebView, signing, background or notification correctness.
6. **Release services and submission:** finish push/revocation, account deletion,
   public policy/support/deletion pages and domain association files; resolve the
   storefront billing/provisioning policy; collect evidence before enabling production.

The client now has an API method for the actual machine JWT endpoint and retains agent
metadata. It does not silently connect the chat UI to the terminal-only protocol.
Managed-cloud testing still needs the selected account/machine; native builds need team-owned
project and signing configuration. The production checklist remains intentionally blocked/pending.

The mobile client reuses the desktop workspace while excluding signup, machine
provisioning, subscriptions and billing/checkout UI. The native API dispatcher rejects
commerce calls as well. Commands run remotely and the application UI is bundled, not
downloaded at runtime. The existing-account companion scope still needs storefront
policy review, and the readiness checklist stays blocked until evidence is collected.
This scope is **not a guarantee of approval**: review the actual service against
[Apple guidelines](https://developer.apple.com/app-store/review/guidelines/) and Play
policies, particularly remote execution and digital services.

## Accounts and builds

1. Confirm team Apple/Google ownership, verification and agreements. Reserve
   `dev.concors.mobile` or change `app.config.ts` before creating records. Previews use `.preview`.
2. Link a team Expo project from `apps/mobile`. Dynamic config needs the returned UUID
   recorded as `EXPO_PUBLIC_EAS_PROJECT_ID` locally and in EAS environments; `eas init`
   cannot be assumed to rewrite `app.config.ts`. Candidate/production checks require
   `EXPO_OWNER` to identify the owning Expo team explicitly.
3. Configure real HTTPS API/project ID in development/preview/production environments.
   Production disables demo/private daemon overrides. Set `EXPO_OWNER` to the team that
   owns the Expo project. `EXPO_PUBLIC_*` must contain no secrets.
4. Configure APNs and FCM v1 credentials under team ownership. Supply `GOOGLE_SERVICES_JSON`
   as an EAS file variable. Never commit service-account keys/signing credentials.
5. Create App Store Connect/Play records, set iOS `ascAppId` in the submit profile and
   configure Play API service-account access. Check first-upload requirements.

Follow [Expo build setup](https://docs.expo.dev/build/setup/) and
[submission instructions](https://docs.expo.dev/deploy/submit-to-app-stores/). SDK 57
targets Android API 36, supports iOS 16.4+ and requires its supported Xcode/toolchain:
see [SDK compatibility](https://docs.expo.dev/versions/v57.0.0/). Recheck at release time.
SDK 57 / React Native 0.86.3 was selected after Expo Doctor identified the
[Hermes memory regression](https://expo.dev/changelog/sdk-57#known-regressions) in SDK 56.

After workspace install, run from `apps/mobile`:

```bash
pnpm dlx eas-cli@latest login
pnpm dlx eas-cli@latest init
pnpm dlx eas-cli@latest build --platform ios --profile simulator
pnpm dlx eas-cli@latest build --platform android --profile development
pnpm dlx eas-cli@latest build --platform ios --profile development
```

Install the build; run `pnpm mobile:dev` from the root for Metro. iPhone development
requires device registration/signing, not the simulator profile. `preview` produces a
standalone APK/ad-hoc iOS build; set demo explicitly in its environment if needed.
Never publish the fixture as the production product. Native push requires real devices.

## Required manual/device matrix

Record device, OS, build and evidence on a physical iPhone and Android:

| Area            | Acceptance                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install/upgrade | Clean install, icon/splash, upgrade preserves valid login, reinstall behavior reviewed                                                                          |
| Auth            | Wrong credentials, offline/slow startup, secure-store failure, expiry, offline logout, org switch, no prior-account workspace                                   |
| Shared state    | Desktop/phone same project/tab/split, phone viewing preserves geometry, concurrent version conflict visible                                                     |
| Chat            | History/streaming/reconnect, approve/decline/questions/secret fields, queue/interrupt, model capabilities                                                       |
| Terminal        | Software/hardware keyboard, paste/IME/Unicode, Ctrl+C/Tab/arrows, long output, desktop ownership transfer, rotate/resize, replay/gaps, renderer restart         |
| Lifecycle       | Wi-Fi/cellular, airplane mode, background/lock for minutes, daemon restart/recovery, no duplicate commands or stop-on-navigation                                |
| Push/links      | Permission/denial/revocation, token refresh, foreground/background/killed app, duplicates/stale/cross-account taps, sign-out revocation, cold/warm domain links |
| Accessibility   | VoiceOver/TalkBack, large fonts, dark mode, small screens, keyboard/safe areas                                                                                  |
| Deletion        | Re-auth, errors not success, organization/machine/billing effects, revocation, functioning external request path                                                |

Browser fixtures/unit tests do not satisfy this table, especially signing, WebView/IME,
backgrounding or APNs/FCM.

## Store material

- Final name/subtitle/description, categories/ratings and real device screenshots.
- Live support/privacy/deletion URLs. Audit account identifiers, user content, device
  tokens, subprocessors and retention with the service owner. Complete App Privacy/Data
  safety from real behavior; no analytics SDK does not mean no data collection.
- In-app deletion and a working web request path. Follow
  [Apple deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
  and [Google deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111).
- Private reviewer credentials and a stable sandbox machine with functioning chat and
  terminal throughout review. Explain remote execution; do not use customer data.
- Recheck encryption/export compliance (current HTTPS/WSS config declares no non-exempt
  encryption), dependency privacy manifests and permissions in the generated binary.
  Android camera, broad media/storage and recording permissions remain blocked. iOS
  attachments use the native system document picker, not in-app capture, so unused
  camera/microphone/photo-library purpose strings were removed. Chat dictation uses the
  OS keyboard. Exercise document selection, cancellation and denial on physical devices.
- Start required closed testing early. Applicable new personal Google accounts require
  12 opted-in testers continuously for 14 days before production access; check the
  [current account requirements](https://support.google.com/googleplay/android-developer/answer/14151465).

Suggested short description: "Your coding workspace, wherever you are."
Describe following agent progress, answering requests and continuing terminal/chat
sessions on existing machines. State account/connected-machine requirements and remote
execution. Only promise notifications after real delivery is verified.

## Production-identity candidates, then submission

The `candidate` build profile creates an IPA/AAB with the **production** bundle/package
ID, scheme, app links and production EAS environment. Unlike `.preview`, it can be used
to collect TestFlight/Play internal evidence for the actual app record. It does not
enable demo data, private daemon overrides or the development launcher scheme. Both
candidate and production use the version in `apps/mobile/package.json`; evidence must
reference that same version.

This separates building a binary from approving its release: physical-device and binary
privacy evidence cannot exist before the binary does. `candidate:check` validates the
declared configuration only, not account ownership, signing or service availability.
It never changes `readiness.json` or approves submission. Custom production profiles
still run the full evidence check; only the explicit `candidate` profile uses build checks.

With the team's real API URL, project UUID and owner loaded in your environment:

```bash
APP_VARIANT=production EXPO_PUBLIC_DEMO=false pnpm --filter @concors/mobile candidate:check --json
# After account/signing setup, from apps/mobile:
pnpm dlx eas-cli@latest build --platform all --profile candidate
```

Do not use auto-submit. Record commit, app version, native build numbers and EAS build IDs.
Inspect the artifacts first. With release-owner approval, upload the **explicit candidate
build ID** using the candidate submit profile for TestFlight/Play internal testing:

```bash
pnpm dlx eas-cli@latest submit --platform ios --profile candidate --id IOS_BUILD_ID
pnpm dlx eas-cli@latest submit --platform android --profile candidate --id ANDROID_BUILD_ID
```

Replace those IDs with reviewed builds, not preview/demo artifacts. Internal testing is
not review submission or public publication, and the consoles may require additional
agreements/metadata. Run the physical-device matrix on that exact build and use its
real screenshots/privacy report as evidence. Rebuilding later requires revalidation.

### Full submission gate

Update `apps/mobile/release/readiness.json` only after verifying each item. Every required
gate needs `status: "verified"`, a named `verifiedBy`, ISO `verifiedAt` and nonempty
`evidence`; choose the approved `releaseModel` as well. It **fails intentionally today**.
EAS pre-install and standard asset/native/export scripts enforce the checklist whenever
the build profile or app variant is production, except the explicit candidate build above. Empty,
missing, duplicate or evidence-free gates cannot pass. This workflow guard is not an
independent compliance audit. `release:check --json` produces a machine-readable report.
Development/preview builds remain available. These are workflow checks, not a security
boundary around manually invoked store CLIs. Always run the full check before requesting
review. CI never uploads/submits automatically.

```bash
pnpm --filter @concors/mobile release:check
# Once every gate is satisfied:
cd apps/mobile
pnpm dlx eas-cli@latest build --platform all --profile production
pnpm dlx eas-cli@latest submit --platform ios --profile production
pnpm dlx eas-cli@latest submit --platform android --profile production
```

TestFlight/Play internal upload is not public publication. Finish testing, metadata and
review submission in each console; allow time for review and fixes.

## Current infrastructure blocker (2026-09-10)

GitHub's latest native jobs did not start: the check annotation reports failed account
payments or an exhausted spending limit. There are no compiler/test logs for those runs.
The retained mobile CI changes keep native workflows manual-only and automatic jobs
bounded to seven minutes. Do not dispatch more native runs until the repository owner
resolves **Billing & plans**. Then manually run `mobile-ios.yml` and `mobile-android.yml`
on the reviewed PR commit; these generate preview-identity engineering artifacts, not
store candidates. Local web/Hermes exports and browser tests cannot replace native CI
or signed physical-device evidence.
