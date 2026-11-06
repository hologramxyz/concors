# iPhone App Store submission — not ready to submit

Reviewed November 6, 2026 against [Apple's App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), the repositories, production configuration, App Store Connect and signed iOS artifacts. This packet concerns iOS; the separate macOS draft has no reviewed Mac App Store binary.

The owner chose **Concors: Coding Workspace**, a **free launch**, machines added on desktop,
**concors.dev** for the public site, **gm@hologram.xyz** for support/privacy, **Rolling Inc.** as the
operator, and **all available countries**. There has been no previous rejection. The requested
minimum age is **13+**, but that conflicts with Privy's current under-16 restriction and remains
unresolved. Do not submit while that conflict or the production acceptance items below remain open.

App: [`6817622624`](https://appstoreconnect.apple.com/apps/6817622624), bundle
`xyz.hologram.concors`, Apple team `9WN4P724M2`, Expo `@guitong35/concors`.
The previous audits and implementation history are in [the November 4–5 audit](audits/2026-11-04-05.md).

## Verified store and production preparation

| Area                | Verified state                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App Store draft     | iOS **0.1.0**, PREPARE_FOR_SUBMISSION. Name, subtitle, feature description, keywords, promotional copy, concors.dev marketing/support/privacy URLs and **2026 Rolling Inc.** copyright saved.                                                                                                                                                                                                                 |
| Private contact     | Complete contact details reused from this same app's existing beta review record. Private details and reviewer secrets are not stored in the repository.                                                                                                                                                                                                                                                      |
| Price and countries | Price zero in the USA and all 174 automatic price territories. All 175 territories selected, including future territories. Selection does not override Apple's regional eligibility requirements.                                                                                                                                                                                                             |
| Agreements / EU     | Free-app agreement is **Active**, current and in effect after the Account Holder's acceptance. App Information identifies this developer as a trader for this app. Paid-app agreement still needs information; this launch has no iPhone commerce.                                                                                                                                                            |
| Credentials         | Dedicated **Concors EAS Submit**, App Manager role, assigned in Expo. The exposed old key was revoked. Apple's team-key role spans apps; the Expo submission assignment is specific to Concors.                                                                                                                                                                                                               |
| Privacy             | Nine linked categories published, with app functionality and the documented Privy sign-in analytics purposes. No tracking declared. See [privacy-disclosures.md](privacy-disclosures.md).                                                                                                                                                                                                                     |
| Website             | [Website PR 13](https://github.com/hologramxyz/concors-web/pull/13) merged and deployed; live policy identifies Rolling Inc., Railway hosting, Privy diagnostics, log-history limits and observed backup configuration. [Website PR 14](https://github.com/hologramxyz/concors-web/pull/14) also explicitly discloses the current 16+ account sign-in requirement; the launch audience decision remains open. |
| Apple provider      | Primary App ID enabled, Services ID `xyz.hologram.concors.auth` and dedicated signing key created; callback `https://auth.privy.io/api/v1/oauth/callback`. Backend signing material stored in production server credentials. Privy configuration and actual user acceptance remain incomplete; production advertises `apple:false`.                                                                           |
| Durable revocation  | [API PR 23](https://github.com/hologramxyz/concors-server/pull/23) merged/deployed: fresh five-minute Apple client proofs avoid a manual six-month JWT expiry breaking deletion. Signing material is not included here.                                                                                                                                                                                       |
| Native artifact     | [Build 12](https://expo.dev/accounts/guitong35/projects/concors/builds/e633163f-9dc7-40e9-b57e-3ee8d4a15504), **0.1.0 (12)** from main `89efcccb5412af7cd1b18a9fce904e11d3a2bf3d`, is VALID / IN_BETA_TESTING, in Internal beta and attached to draft 0.1.0. [Signed inspection](ios-build-12.json) verifies all nine categories/purposes and preserved SDK reasons.                                          |
| Native screenshots  | One visually inspected **1320 × 2868** native iPhone capture is processed and active in the draft's 6.9-inch set. Additional views and the full native interaction run remain pending. See [capture evidence](ios-native-evidence.md); simulator images do not establish physical-device acceptance.                                                                                                          |

## Remaining release blockers

1. **Production Apple / Privy acceptance.** Configure the prepared custom Apple key in the existing
   Privy app, enable return of OAuth tokens, and enable Apple only after correct provider settings.
   Keep allowed domains. Verify first-time/returning sign-in, Hide My Email, cancellation and revocation
   on a signed iPhone. The environment's backend app secret does not replace dashboard access.
2. **Reviewer access.** Enable Privy's generated test accounts; retrieve credentials securely and
   populate Apple's private review fields. Assign an isolated, already connected machine and working
   AI-provider access that remain available throughout review. Do not expose a customer's workspace,
   a developer host or the agent's credentials. Verify the exact review route and deletion on a
   separate disposable account before final handoff.
3. **Age.** The owner requested 13+. [Privy's policy](https://www.privy.io/privacy-policy), updated
   May 20, 2026, says people under 16 should not register/use its service. Either obtain confirmation
   supporting the intended audience/change authentication, or use an owner-approved 16+ minimum.
   The current 13+ App Store override and website copy must be aligned with the resolved decision.
4. **Content rights.** Apple's content-rights declaration is unset. Confirm the necessary rights
   for displayed assets/content and users' authorized repository/workspace access before attesting.
5. **Screenshots and real device acceptance.** Finish the native screenshot set and interaction checks.
   Complete install/upgrade, permissions, keyboard, reconnect, accessibility, AI decline/withdrawal,
   support reporting and deletion on a physical iPhone. Native simulator/browser checks alone do not
   establish this acceptance. Confirm support/report triage is operated.

Do not infer readiness from a successful upload. The iOS-only gate file is
[readiness-ios.json](readiness-ios.json); the Android/combined gates remain separate.
`node apps/mobile/scripts/release-check.mjs --platform=ios --json` must continue failing until the
remaining evidence exists. No public App Review or external beta review has been submitted.

## Review guidance

The app bundles its native interface and workspace renderer; structured workspace data is exchanged
with authorized computers. Coding tools/terminal commands run on the connected machine. It has no
public social feed, user-to-user chat, embedded unrestricted browser, app marketplace or mobile
machine/subscription checkout. Explain these actual boundaries in review notes; Apple determines
which remote-client or software rules apply.

Check guideline **2.1** with working reviewer access; **2.3** with accurate screenshots, rating and
metadata; **3.1** with the free companion scope; **4.2 / 4.2.7 / 4.7** against the implemented remote
workspace behavior; **4.8** with configured Apple sign-in; **5.1.1** with same-user deletion and
retention; and **5.1.2** with named third-party AI permission. Reporting/abuse operations must match
app capabilities and Apple's applicable **1.2 / 4.7** requirements. A guideline review cannot
promise approval.
