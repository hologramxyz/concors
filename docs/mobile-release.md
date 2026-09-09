# Mobile release runbook

## Shortest path

Client/demo/shared lifecycle/protocol integration/build profiles are implemented.
No signed IPA/AAB, store release or production validation is implied by bundle export.
Test the UI now; have Pierre implement [server contracts](mobile-backend.md); prepare
team-owned Expo/Apple/Google accounts in parallel. Live end-to-end testing requires a
provisioned daemon behind the authenticated gateway.

The mobile client now reuses the desktop workspace, including account creation,
machine provisioning and billing/checkout UI. Commands still run remotely and the
application UI is bundled, not downloaded at runtime. **Billing and provisioning need
a storefront-specific policy decision before production**; do not assume the desktop
checkout flow can ship unchanged. The production readiness checklist blocks release
until this audit is complete. This scope is **not a guarantee of approval**: review the actual service against
[Apple guidelines](https://developer.apple.com/app-store/review/guidelines/) and Play
policies, particularly remote execution and digital services.

## Accounts and builds

1. Confirm team Apple/Google ownership, verification and agreements. Reserve
   `dev.concors.mobile` or change `app.config.ts` before creating records. Previews use `.preview`.
2. Link a team Expo project from `apps/mobile`. Dynamic config needs the returned UUID
   recorded as `EXPO_PUBLIC_EAS_PROJECT_ID` locally and in EAS environments; `eas init`
   cannot be assumed to rewrite `app.config.ts`. Set `EXPO_OWNER` if needed.
3. Configure real HTTPS API/project ID in development/preview/production environments.
   Production disables demo/private daemon overrides. `EXPO_PUBLIC_*` must contain no secrets.
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
  Android broad media/storage/recording permissions remain blocked. iOS attachment
  selection/capture includes purpose descriptions for photos, camera and video audio;
  exercise permission denial as well as success. Chat dictation uses the OS keyboard.
  See the [WebView upload requirements](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Guide.md#add-support-for-file-upload).
- Start required closed testing early. Applicable new personal Google accounts require
  12 opted-in testers continuously for 14 days before production access; check the
  [current account requirements](https://support.google.com/googleplay/android-developer/answer/14151465).

Suggested short description: "Your coding workspace, wherever you are."
Describe following agent progress, answering requests and continuing terminal/chat
sessions on existing machines. State account/connected-machine requirements and remote
execution. Only promise notifications after real delivery is verified.

## Production gate and submission

Update `apps/mobile/release/readiness.json` only after verifying each item; record evidence
in the release PR. It **fails intentionally today**. EAS production pre-install enforces
the checklist/configuration; this workflow guard is not an independent compliance audit.
Development/preview builds remain available. CI never uploads/submits automatically.

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
