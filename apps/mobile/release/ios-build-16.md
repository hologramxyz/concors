# Signed iPhone build 16 — push candidate

Verified 2026-11-07T03:53:24.263Z. **Available in Internal TestFlight.** The dedicated APNs key and
production activation were [verified November 8](ios-push-activation.md). The owner then confirmed
completion-alert delivery and tap-to-chat on a physical iPhone; see
[the device report](ios-build-16-device-acceptance.md). Other phone acceptance remains pending.
Public App Review is not submitted.

| Field                  | Verified value                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Version                | 0.1.0 (16)                                                                                                                               |
| Bundle                 | `xyz.hologram.concors`                                                                                                                   |
| Paid Apple team        | `9WN4P724M2`                                                                                                                             |
| Source revision        | `75be916a4f5beded50270a071daf532ba847717a`                                                                                               |
| EAS build              | [39d8fcbc-e28f-405d-a893-c7c02b049790](https://expo.dev/accounts/guitong35/projects/concors/builds/39d8fcbc-e28f-405d-a893-c7c02b049790) |
| EAS profile            | `candidate`, store distribution and production environment                                                                               |
| Apple build            | `440f1390-8dc3-4931-8c7a-8edaa2f8c90e`                                                                                                   |
| Apple processing       | `VALID`                                                                                                                                  |
| Internal beta          | `IN_BETA_TESTING`; existing Internal group contains build: true                                                                          |
| Draft iOS 0.1.0        | `PREPARE_FOR_SUBMISSION`; build attached: true                                                                                           |
| Native UI              | One ExpoUI **57.0.26** pod; app and router resolve the same module                                                                       |
| Push entitlement       | `aps-environment=production` in both signed executable and embedded profile                                                              |
| SDK / Xcode            | `iphoneos26.5` / `2660`                                                                                                                  |
| Minimum iOS / family   | `16.4` / iPhone                                                                                                                          |
| Encryption declaration | `ITSAppUsesNonExemptEncryption=false`                                                                                                    |
| IPA SHA-256            | `481444b1bb4ff42bcbbee99fffe6d583cc1aa0e9c765a1a6832e42c400656da1`                                                                       |

## Signed artifact checks

The downloaded store IPA contains the expected app version/build, source revision and production
API origin. Its profile is for the paid team above, has no device list or enterprise provisioning,
and disallows debugging. The executable carries the same app identifier and production push
entitlement. There is no associated-domains entitlement. Photo-picker and dictation purpose strings
are present; no camera purpose is added. The saved AI-sharing consent implementation is embedded.

The merged UI fix pins both app and router to 57.0.26. The EAS log confirms `Installing ExpoUI
(57.0.26)`. Expo Doctor no longer reports duplicate native modules: 20 of 21 checks pass. Its remaining
warning concerns other Expo SDK patch-version recommendations; those dependencies were not broadly
upgraded in this push setup. The owner subsequently exercised push on this build; installation and
upgrade/session-restoration behavior were not separately reported.

The native privacy manifest contains all nine linked categories: Name, Email Address, User ID,
Device ID, Product Interaction, Other User Content, Photos or Videos, Customer Support, and Other
Diagnostic Data. All declare app functionality and no tracking; User ID, Device ID, Product
Interaction and Other Diagnostic Data also preserve the Privy sign-in analytics purpose. Required
API reasons remain File Timestamp `C617.1`, User Defaults `CA92.1`, and System Boot Time `35F9.1`.

## Rollout boundaries

- A new full native build was used; no over-the-air-only release or Personal Team signing.
- The Apple bundle push capability is enabled. A dedicated Concors production APNs key is
  assigned in Expo and restricted to this app's production topic; the existing Heist key is unchanged.
- Enhanced Expo push security is disabled at the inspected project setting, so the server does
  not currently require `EXPO_ACCESS_TOKEN`. Production push is enabled and the authenticated API
  advertises it; see [the November 8 readback](ios-push-activation.md).
- The updated privacy page is live at https://concors.dev/privacy; existing Device ID/functionality
  declarations cover optional push identifiers. Android/Firebase setup is outside this iOS rollout.
- Seventeen focused push regressions, 222 mobile tests and mobile typechecking passed. PR 187 and
  PR 188 each passed all 19 CI checks before merge. The owner confirmed real-phone completion
  delivery and tap routing; needs-input/error delivery and remaining navigation/revocation cases
  are pending.
- [Physical acceptance and activation checklist](ios-push-acceptance.md) remains open, alongside the
  other [App Store submission requirements](submission-packet.md). No public or external beta
  review was submitted.

Only sanitized verification fields are recorded here. Device tokens, APNs keys, account/session
credentials, reviewer secrets, provisioning certificates and private artifact URLs are excluded.
