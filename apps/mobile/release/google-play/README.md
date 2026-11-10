# Google Play launch preparation

Prepared November 10, 2026. Package `xyz.hologram.concors`, Expo project
`b928233e-14cd-4e58-95e5-b19d8101bcb6` owned by `guitong35`, legal company Rolling Inc.
The owner created developer account **8831514612940319255** and supplied its
[Console dashboard](https://play.google.com/console/u/1/developers/8831514612940319255/home).
Its verification status and app record have not yet been read back through an authenticated
Play Console session.

## Prepared and pending

- [Listing](listing.json): selected name, free launch, all available countries, support/site links,
  remote-workspace requirements and copy without unverified Android push promises.
- [Data safety](data-safety.md): Android-specific data inventory and deletion/sharing answers,
  with an importable CSV draft. Current Console account/deletion questions still need completing.
- Expo Android signing is configured under **Concors Google Play**, for the production package.
  The keystore stays in Expo. No unrelated app credential is used.
- Firebase project **concors-mobile-hologram** belongs to the Hologram Cloud organization. Its
  Android app matches the production package. Google Analytics and Crashlytics were not added.
  The Firebase config is assigned to EAS production as secret file `GOOGLE_SERVICES_JSON`.
- Dedicated submission and FCM service keys are assigned in Expo. The FCM account has Cloud
  Messaging permission; the submission account does not. A validate-only request reached FCM
  token validation, which checks authorization but does not prove real-device delivery.
- Four real Android captures, four finished phone marketing images, the 1024×500 feature graphic
  and 512×512 icon are in [exports](exports/). [Capture evidence](capture-evidence.json) binds the
  fictional store fixture to the successful native emulator run and exact source APK commit.
- Signed production-identity candidate **0.1.0 (3)** is finished from
  `8087bbcb3948ba3b22ed7d1a8e091793981a079c`. Its original AAB audit and production welcome-screen
  emulator check passed. [Build evidence](build-3.json) records the hashes, signing fingerprint,
  Firebase identity and successful native run. [Readiness](readiness.json) keeps upload and device
  checks separate.
- Native compilation, APK permissions/alignment and workspace/keyboard tests passed in
  [run 42740003578](https://github.com/hologramxyz/concors/actions/runs/42740003578).
  Production authentication and physical-device push are separate from those preview checks.
- The Android privacy/support/terms update is merged in
  [website PR 19](https://github.com/hologramxyz/concors-web/pull/19) and live at concors.dev.
- The [Console declaration packet](console-answers.md) covers audience, account access, ads,
  account deletion and content-rating context. Actual IARC and current Console forms remain open.
- Reviewer production email login/PKCE was rechecked on November 10, with no provider errors.
  The review machine, gateway, session host and AI service are running; see
  [reviewer backend evidence](reviewer-backend.json). Android-native authentication is still pending.
- Play app/package access, owner verification, final internal upload, Android device delivery,
  IARC rating and Console-only declarations remain pending. Nothing has been published to Play.

The owner selected **16+** as the service minimum. In Target audience choose 16–17 and 18+;
Google's actual age rating is determined separately by the truthful IARC questionnaire. Complete
the ads, app access, data safety, content rating, target audience and any other Console-required
declarations against the real app. The app is a coding/productivity tool, with no mobile checkout,
public content feed or machine provisioning. Do not describe it as a general-purpose local code
runtime: commands run on authorized connected machines.

## Account connection

The developer account creation does not sign this workspace into Google or automatically grant
Expo Play access. An authorized owner must complete any identity, website, contact or agreement
verification shown in Console. The corporate address must match the current D&B/Google Payments
record; the Apple public trader address alone is not proof of the D&B address.

1. In Play Console create **Concors: Agent Orchestrator**, English (United States), **App**, **Free**,
   package `xyz.hologram.concors` when prompted. Confirm the resulting app/developer account URL.
2. Invite `concors-expo-submit@concors-mobile-hologram.iam.gserviceaccount.com` in Play Console
   with access to Concors: view app information, manage store presence, testing releases,
   testing tracks/tester lists, draft apps and policy declarations as available in Console.
   The service account and Expo Submit key are already created. A Cloud IAM role by itself
   does not grant Play Console app permissions. Production-release permission can wait.

If the release operator is setting up Firebase/Cloud through this workspace, the owner can sign
in privately in its terminal with `npx firebase-tools login --no-localhost`. Enter the sign-in
response in the terminal, not chat. A Firebase CLI login does not grant Play Console permissions.

Follow the [Expo Google service-account guide](https://expo.fyi/creating-google-service-account)
and [submission prerequisites](https://docs.expo.dev/submit/android/). The current submission guide
supports a first release through EAS after the app record and credentials exist. A manual upload
remains available if Console/API setup requires it; do not assume either route has succeeded.

## Android push

The Android Firebase app and EAS production file are configured. To reproduce setup, register the
exact production package without adding Google Analytics or Crashlytics, and set the downloaded
`google-services.json` as the **file** variable `GOOGLE_SERVICES_JSON` in EAS production.

The dedicated FCM V1 key is assigned in Expo. Keep submission and FCM service accounts separate
so their Play/Cloud permissions and rotation remain independent. FCM requires Firebase Cloud
Messaging permissions; a Play submission key alone cannot deliver push.
See [Expo FCM instructions](https://docs.expo.dev/push-notifications/fcm-credentials/).

The server push feature is already deployed for iPhone. Check the Android registration,
notification permission/channel, completion delivery, tapping into the correct chat and opt-out
on the final Android build. Do not infer Android FCM delivery from the iPhone APNs checks.

## Build and upload

After the Firebase file and native credentials are assigned, build a production-identity candidate
from a recorded reviewed commit. From `apps/mobile`, with the production EAS environment:

```bash
APP_VARIANT=production npx eas-cli build --platform android --profile candidate
```

Inspect the AAB/APK for the package, version code, target SDK, blocked permissions, app signing
and Android 16 KB compatibility. Record the exact build ID/source commit. The candidate profile
allows collecting native evidence; it does not approve a public release or mark readiness gates
verified. Keep outstanding auth/device/Google verification gates visible in [readiness.json](readiness.json).

**Actions → Mobile Android native** accepts `candidate_aab_url`, `candidate_sha256`,
`candidate_version_code` and the public `candidate_cert_sha256`. It verifies the original AAB's
upload certificate, production package/Firebase identity, permissions and 16 KB ELF alignment,
then derives an APK signed with a temporary test key. The emulator checks the real production
welcome screen, sign-in options and legal links. This does not establish completed OAuth,
Play-signed installation or physical push delivery. No production signing key is downloaded.

For marketing fixture capture, use `marketing_captures`; `preview_run_id` can reuse a compiled
preview APK. Those preview artifacts must never be submitted as the production app.

The existing candidate submission profile selects **internal** and **draft**:

```bash
APP_VARIANT=production npx eas-cli submit --platform android --profile candidate --id ANDROID_BUILD_ID
```

Confirm the uploaded package/version code and draft state in Console before completing the
internal release and adding testers. Only use a final reviewed production-identity build, never
the preview demo/store-capture artifact.

## Reviewer access

Use the verified private reviewer email/test code from the release workspace, entered in Play's
**App access** instructions. Do not put it into public listing text. Provide the existing isolated
`concors-app-review` machine and **Task Notes → Review agent**, with working company-funded API
access. The same machine can serve both stores while their reviews are open; preserve it and its
quota for that period. The iOS packet's post-review cleanup must wait until every active review
has finished.

Explain: sign in by email, open the supplied machine/project, send a short agent prompt, approve
tool requests, browse files/use Checks terminal, report content in Settings → Account, and find
account deletion there. No reviewer purchase, machine setup or personal AI subscription is needed.

Recheck the production reviewer login and machine before uploading; previous iOS evidence does
not replace Android-native login/navigation and FCM checks. Internal testing is not public review
approval or public publication.
