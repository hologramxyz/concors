# iPhone App Store submission — not ready to submit

Reviewed November 6, 2026 against [Apple's App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), the repositories, production configuration, App Store Connect and signed iOS artifacts. This packet concerns iOS; the separate macOS draft has no reviewed Mac App Store binary.

The owner chose **Concors: Coding Workspace**, a **free launch**, machines added on desktop,
**concors.dev** for the public site, **gm@hologram.xyz** for support/privacy, **Rolling Inc.** as the
operator, and **all available countries**. There has been no previous rejection. The owner approved
a **16+ launch minimum**, aligned with Privy's current policy; Apple's `SIXTEEN_PLUS` override is
saved. Do not submit while the production acceptance items below remain open.

App: [`6817622624`](https://appstoreconnect.apple.com/apps/6817622624), bundle
`xyz.hologram.concors`, Apple team `9WN4P724M2`, Expo `@guitong35/concors`.
The previous audits and implementation history are in [the November 4–5 audit](audits/2026-11-04-05.md).

## Verified store and production preparation

| Area                | Verified state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App Store draft     | iOS **0.1.0**, PREPARE_FOR_SUBMISSION. Name, subtitle, feature description, keywords, promotional copy, concors.dev marketing/support/privacy URLs and **2026 Rolling Inc.** copyright saved.                                                                                                                                                                                                                                                                                                                                                             |
| Private contact     | Complete contact details reused from this same app's existing beta review record. Private details and reviewer secrets are not stored in the repository.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Reviewer login      | Privy test accounts enabled; one issued account completed normal production email sign-in and PKCE exchange. Its login and fixed-code instructions are saved in Apple’s private App Review fields. It has **one isolated connected machine** with verified files/terminal/reconnect; AI access remains pending. See [reviewer-access.json](reviewer-access.json) and [host proof](review-host.json). Browser verification does not establish signed-iPhone acceptance.                                                                                    |
| Price and countries | Price zero in the USA and all 174 automatic price territories. All 175 territories selected, including future territories. Selection does not override Apple's regional eligibility requirements.                                                                                                                                                                                                                                                                                                                                                         |
| Agreements / EU     | Free-app agreement is **Active**, current and in effect after the Account Holder's acceptance. App Information identifies this developer as a trader for this app. Paid-app agreement still needs information; this launch has no iPhone commerce.                                                                                                                                                                                                                                                                                                        |
| Credentials         | Dedicated **Concors EAS Submit**, App Manager role, assigned in Expo. The exposed old key was revoked. Apple's team-key role spans apps; the Expo submission assignment is specific to Concors.                                                                                                                                                                                                                                                                                                                                                           |
| Privacy             | Nine linked categories published, with app functionality and the documented Privy sign-in analytics purposes. No tracking declared. See [privacy-disclosures.md](privacy-disclosures.md).                                                                                                                                                                                                                                                                                                                                                                 |
| Website             | [Website PR 13](https://github.com/hologramxyz/concors-web/pull/13) merged and deployed; live policy identifies Rolling Inc., Railway hosting, Privy diagnostics, log-history limits and observed backup configuration. [Website PR 15](https://github.com/hologramxyz/concors-web/pull/15) aligns the terms/privacy minimum with the owner-approved 16+ launch.                                                                                                                                                                                          |
| Launch age          | Owner approved **16+**. Apple's override reads `SIXTEEN_PLUS`, with age-suitability URL `https://concors.dev/terms`. This resolves the previous 13+/Privy conflict. No age-assurance or parental-control mechanism is claimed.                                                                                                                                                                                                                                                                                                                            |
| Content rights      | Owner confirmed the necessary rights to displayed assets/content and authorized repository/machine access. Apple's declaration reads `USES_THIRD_PARTY_CONTENT`. [Readback and authorization](launch-policy.json) record both launch-policy decisions.                                                                                                                                                                                                                                                                                                    |
| Apple provider      | Primary App ID enabled, Services ID `xyz.hologram.concors.auth` and dedicated signing key created; callback `https://auth.privy.io/api/v1/oauth/callback`. Backend signing material stored in production server credentials. Privy Apple is enabled, and the deployed API advertises `apple:true`. The normal production sign-in page generates an authorization request with the correct Client ID/callback; actual Apple account sign-in, token return and device acceptance remain pending. See [activation evidence](apple-provider-activation.json). |
| Durable revocation  | [API PR 23](https://github.com/hologramxyz/concors-server/pull/23) merged/deployed: fresh five-minute Apple client proofs avoid a manual six-month JWT expiry breaking deletion. Signing material is not included here.                                                                                                                                                                                                                                                                                                                                   |
| Native artifact     | [Build 16](https://expo.dev/accounts/guitong35/projects/concors/builds/39d8fcbc-e28f-405d-a893-c7c02b049790), **0.1.0 (16)** from main `75be916a`, is VALID / IN_BETA_TESTING in Internal beta and attached to draft 0.1.0. [Signed proof](ios-build-16.md) verifies production push entitlements, one ExpoUI 57.0.26 module and nine privacy categories/purposes. [November 8 push activation](ios-push-activation.md) is verified; physical delivery remains pending.                                                                                   |
| Native screenshots  | One visually inspected **1320 × 2868** native iPhone capture is processed and active in the draft's 6.9-inch set. The native simulator control/draft flow passes; final screenshot selection and production/physical-device acceptance remain pending. See [capture evidence](ios-native-evidence.md); simulator images do not establish physical-device acceptance.                                                                                                                                                                                      |

November 7 push update: [website PR 16](https://github.com/hologramxyz/concors-web/pull/16) is merged
and live, covering optional push identifiers, Expo/Apple delivery, previews, choices and retention.

## Remaining release blockers

1. **Production Apple acceptance.** Privy and the deployed API now enable Apple with the correct
   Concors Services ID/callback. A normal browser generates the matching authorization request; no
   Apple account authentication or token exchange has been completed by this check. Verify return
   of OAuth tokens, first-time/returning sign-in, Hide My Email, cancellation and revocation on a
   signed iPhone. Keep allowed domains. See [activation evidence](apple-provider-activation.json).
2. **Reviewer workspace.** The dedicated email login is verified and saved privately in Apple.
   Its isolated VM is connected and files/terminal/reconnect checks pass. Configure working company
   AI-provider access with bounded billing and keep the machine available throughout review. Do not expose a customer's
   workspace, a developer host or the agent's credentials. Verify the exact review route and deletion
   on a separate disposable account before final handoff. Keep Privy test accounts enabled throughout
   review: disabling/re-enabling rotates the credentials, which would require updating Apple's fields.
3. **Screenshots and real device acceptance.** Finish the native screenshot set and interaction checks.
   Complete install/upgrade, permissions, keyboard, reconnect, accessibility, AI decline/withdrawal,
   support reporting and deletion on a physical iPhone. Native simulator/browser checks alone do not
   establish this acceptance. Confirm support/report triage is operated.

4. **iPhone push acceptance.** The dedicated production APNs key is assigned in Expo, the policy
   is live, native build 16 has production push entitlements, and the deployed API advertises push.
   [Configuration and rollout readback](ios-push-activation.md) are verified. Complete opt-in,
   completion/input/error delivery, tap-to-chat and registration-revocation checks on a real phone.
   See [ios-push-acceptance.md](ios-push-acceptance.md). The previous push exclusion no longer
   satisfies the release gate.

Do not infer readiness from a successful upload. The iOS-only gate file is
[readiness-ios.json](readiness-ios.json); the Android/combined gates remain separate.
`node apps/mobile/scripts/release-check.mjs --platform=ios --json` must continue failing until the
remaining evidence exists. No public App Review or external beta review has been submitted.

## Dedicated reviewer machine — provisioned; AI pending

The owner approved **USD 30/month** while App Review remains open. One company-owned OVH US
VPS-1 is provisioned in Virginia with Ubuntu 24.04, x86_64, **2 vCores / 4 GB RAM / 40 GB disk**.
The first one-month order, including mandatory options and tax, was **USD 5.35**. It is attached as
an **external machine** only to the isolated reviewer organization; no Stripe machine subscription
was created on the review account. [Deployment and verification](review-host.json) excludes access
credentials, addresses and provider account identifiers.

| Item    | Actual state / remaining work                                                                                                                                                                                                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting | USD 5.35 initial monthly charge; one-month billing and automatic renewal. Keep it online through review and follow-up, then verify cancellation and deletion.                                                                                                                                  |
| AI      | Pi 1.5.0 is installed. A working company provider credential and billing limit remain required. A separate Anthropic workspace/key is an optional isolation method; an existing company key with an appropriate limit is acceptable. No new Claude subscription is required for this proposal. |
| Budget  | Owner approved USD 30/month total. USD 20/month is the proposed AI allowance; its provider-side limit is not configured because AI access is not yet supplied. No optional hosting add-ons were purchased.                                                                                     |
| Access  | TLS, scoped machine-token connection, sample file listing/read, real terminal tests and reconnect verified. The account sees exactly this one machine. Signed-iPhone acceptance remains pending.                                                                                               |

Pricing references: [OVH US catalog](https://api.us.ovhcloud.com/1.0/order/catalog/public/vps?ovhSubsidiary=US),
[OVH VPS specifications](https://us.ovhcloud.com/vps/), and
[Anthropic workspace limits](https://platform.claude.com/docs/en/manage-claude/workspaces).
The order quote was checked before the authorized purchase. Review future hosting/provider charges
against the approved monthly budget.

The standard installer requires Ubuntu/Debian with systemd and SSH. The normal relay connection,
TLS and machine-token checks are in use. SSH password/root login are disabled, SSH uses keys and the
host firewall is active. The runtime's standard `ubuntu` user has sudo, so the entire VM is treated
as disposable; it contains no customer repository, shared production credential or developer login.

The original **Task Notes** sample is a local Git repository with a README, source files, three
passing Node tests and a useful next task. File inspection, test execution and reconnect were
verified through the review account's normal authenticated machine protocol. The released daemon
is **0.13.0**. A gateway restart initially interrupted the terminal: the direct systemd host used a
different build identity and was replaced by a gateway-owned child. The review host now supplies the
matching fingerprint through a service wrapper. Its session host remains owned by its own systemd
service, and another gateway restart preserved the **same running terminal**. The accompanying CLI
fix and regression test make direct service launches compute that fingerprint in a normal daemon
release.

After company AI access is configured, verify a real response and permitted edit through the app's
normal named-provider consent, then finish the saved reviewer's signed-iPhone route, token renewal,
background/reconnect and final screenshots. Verify deletion with a separate disposable account.
Keep Privy test accounts enabled throughout review: toggling the feature rotates the saved login.
Health/credit checks and support/report handling must be operated throughout review.

Once review is closed, revoke the review-only provider credential, detach the external machine,
destroy the VPS and backups, and verify that renewal/billing stopped. Removing an external machine
from Concors alone does **not** destroy the VM or stop hosting charges.

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

## Mobile permission and sign-in fixes

The new candidate remembers AI-sharing approval on this device for the API, account, organization and machine. Conversations, model changes and reconnects reuse it; provider configuration changes require fresh permission. Declining or withdrawing blocks new applicable requests, including while reconnecting. Seventeen focused permission regressions pass. The owner confirmed on November 7 that TestFlight 0.1.0 (13) shows one prompt and remembers approval across several conversations and closing/reopening the app. [Device confirmation](ios-build-13-device-acceptance.md) records the tested scope. Signed-device decline, withdrawal, reconnection and configuration-change checks remain pending.

Social sign-in retries now clear partial Privy sessions and prevent duplicate OAuth starts. Four component regressions pass; the server suite passes 490 tests with 54 database-dependent cases skipped. The original error from the owner’s Privy screen was not captured, so real GitHub sign-in and Apple-account acceptance on the signed iPhone still require confirmation. The owner reported on November 7 that GitHub sign-in has not yet been tested on build 13.
