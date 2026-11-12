# Google Play launch preparation

Updated November 12, 2026. Package `xyz.hologram.concors`, Expo project
`b928233e-14cd-4e58-95e5-b19d8101bcb6` owned by `guitong35`, legal company Rolling Inc.
Developer account **8831514612940319255** is connected and the dedicated submission account has
working app access. Its identity/contact verification state has not been observed in Console.

## Uploaded and verified

- **0.1.0 (3)** is uploaded through [Expo Submit](https://expo.dev/accounts/guitong35/projects/concors/submissions/fb4cbcdd-f461-42fb-a5ab-abaad4c3a5ad).
  The exact AAB hash matches [build evidence](build-3.json). This binary was built from
  `8087bbcb3948ba3b22ed7d1a8e091793981a079c`; later main-branch changes are not in it.
- The **internal** track reads back **completed**, with version code 3 and the prepared release
  notes. The **production** track has no release. This is an internal test release, not public
  publication or Google policy approval.
- The English title, short/full descriptions, `gm@hologram.xyz` support email and `concors.dev`
  website read back correctly. Four phone screenshots, one feature graphic and one icon match
  the exact prepared SHA-256 hashes and screenshot order.
- The images use real Android UI captures. Their decorative campaign background was created with
  image generation, so the four composites and feature graphic carry the API's AI-origin
  attestation. No unverified AI-origin assertion was supplied for the existing app icon.
- Google accepted the updated [Data safety CSV](data-safety-draft.csv), including email-code/OAuth
  account creation and the account-deletion URL. This write has no readback endpoint and does not
  establish that all other Console declarations are complete.
- Google generated signed APKs. The Play signing certificate differs from Expo's upload
  certificate, as expected for Play App Signing. Both fingerprints and the exact upload/readback
  evidence are in [play-upload-2026-11-12.json](play-upload-2026-11-12.json).

## Remaining Console steps

Open the [developer dashboard](https://play.google.com/console/u/1/developers/8831514612940319255/home)
and select Concors.

1. **Testing → Internal testing → Testers**: select an email list containing
   `simone@hologram.xyz`, then copy the tester opt-in link. The API supports Google Groups but
   cannot read/update individual email lists or return the opt-in URL. No tester email or link
   has been inferred from an empty API response.
2. Before public submission, verify the privacy URL `https://concors.dev/privacy`, Productivity
   category, all-available-country scope, free pricing, no ads, audience 16–17 and 18+, IARC content
   rating and the other required App content forms. [The declaration packet](console-answers.md)
   supplies the prepared answers. The service minimum **16+** is separate from the IARC rating.
3. Enter the private reviewer login/instructions in **App content → App access**. Use the existing
   isolated `concors-app-review` machine, **Task Notes → Review agent** and company-funded AI.
   The private packet is in the operator's release workspace; credential values never belong in
   public listing text or this repository. Preserve the machine while either store's review is open.
4. Complete any developer identity, contact, website or agreement verification shown by Console.
   Corporate address verification must use the current D&B/Google Payments record; a historical
   filing or Apple trader address is not proof of the current record.

[Readiness](readiness.json) keeps installed-device authentication, workspace and Android push
checks open. The internal release state does not prove an eligible tester has installed it.

## Native evidence and Firebase

The original signed AAB passes production identity, upload-certificate, Firebase app identity,
restricted-permission and 16 KB ELF checks. Its derived APK also passes ZIP alignment and the
production welcome/sign-in-options/legal-links emulator smoke. The emulator APK uses a temporary
signing key; the original upload signature was checked separately. Completed Android OAuth,
physical push delivery and physical 16 KB-device runtime testing have not been established.

Preview native compilation, workspace navigation, keyboard and draft-preservation evidence is in
[run 42740003578](https://github.com/hologramxyz/concors/actions/runs/42740003578). Marketing captures
use a fictional preview fixture, with hashes/source APK binding in [capture evidence](capture-evidence.json).
Those preview artifacts must never be submitted as the production app.

Firebase project **concors-mobile-hologram** belongs to the Hologram Cloud organization and its
Android app matches the production package. Analytics and Crashlytics were not added. The Firebase
config is assigned to EAS production as secret file `GOOGLE_SERVICES_JSON`. Dedicated submission
and FCM credentials are assigned in Expo; the FCM account has Cloud Messaging permission and the
submission account does not. A validate-only FCM request checked authorization without proving
delivery to a physical device. No unrelated app credential is used and no signing key was downloaded.

The Android privacy/support/terms update is merged in
[website PR 19](https://github.com/hologramxyz/concors-web/pull/19) and live at concors.dev. Reviewer
production email/PKCE and the running machine/AI services were checked November 10; see
[reviewer backend evidence](reviewer-backend.json). These browser/backend checks do not replace
Android-native authentication and notification checks.

## Future builds and uploads

From `apps/mobile`, create a production-identity candidate with the configured EAS production
file and credentials:

```bash
APP_VARIANT=production npx eas-cli build --platform android --profile candidate
```

Record the exact source/build ID and audit the AAB before upload. The candidate profile permits
native evidence collection; it does not approve a public release. The submission profile selects
**internal** and **draft**:

```bash
APP_VARIANT=production npx eas-cli submit --platform android --profile candidate --id ANDROID_BUILD_ID
```

The first upload through EAS succeeded after the owner created the app and invited the service
account. Confirm each upload's version code and AAB hash by reading it back from Play. Promote
only the intended internal version and verify the committed track state before sharing it.

**Actions → Mobile Android native** accepts `candidate_aab_url`, `candidate_sha256`,
`candidate_version_code` and the public `candidate_cert_sha256`. It audits the bundle and derives
an emulator APK without downloading production signing keys. Use `marketing_captures` for the
fictional store fixture and `preview_run_id` to reuse a compiled preview APK.

Keep Play edit operations and their verification sequential: a second edit for the same app and
service account invalidates the earlier edit. For this new app, Google rejected the optional
`changesNotSentForReview` parameter; committing without it worked. Do not infer a production
release or policy approval from a successful listing/Data safety write.

References: [Expo submission](https://docs.expo.dev/submit/android/),
[Google service-account setup](https://expo.fyi/creating-google-service-account),
[Expo FCM setup](https://docs.expo.dev/push-notifications/fcm-credentials/).
