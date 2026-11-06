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
| Reviewer login      | Privy test accounts enabled; one issued account completed normal production email sign-in and PKCE exchange. Its login and fixed-code instructions are saved in Apple’s private App Review fields. It has **zero connected machines**; see [reviewer-access.json](reviewer-access.json). Browser verification does not establish signed-iPhone acceptance.                                                                                                                                                                                                |
| Price and countries | Price zero in the USA and all 174 automatic price territories. All 175 territories selected, including future territories. Selection does not override Apple's regional eligibility requirements.                                                                                                                                                                                                                                                                                                                                                         |
| Agreements / EU     | Free-app agreement is **Active**, current and in effect after the Account Holder's acceptance. App Information identifies this developer as a trader for this app. Paid-app agreement still needs information; this launch has no iPhone commerce.                                                                                                                                                                                                                                                                                                        |
| Credentials         | Dedicated **Concors EAS Submit**, App Manager role, assigned in Expo. The exposed old key was revoked. Apple's team-key role spans apps; the Expo submission assignment is specific to Concors.                                                                                                                                                                                                                                                                                                                                                           |
| Privacy             | Nine linked categories published, with app functionality and the documented Privy sign-in analytics purposes. No tracking declared. See [privacy-disclosures.md](privacy-disclosures.md).                                                                                                                                                                                                                                                                                                                                                                 |
| Website             | [Website PR 13](https://github.com/hologramxyz/concors-web/pull/13) merged and deployed; live policy identifies Rolling Inc., Railway hosting, Privy diagnostics, log-history limits and observed backup configuration. [Website PR 15](https://github.com/hologramxyz/concors-web/pull/15) aligns the terms/privacy minimum with the owner-approved 16+ launch.                                                                                                                                                                                          |
| Launch age          | Owner approved **16+**. Apple's override reads `SIXTEEN_PLUS`, with age-suitability URL `https://concors.dev/terms`. This resolves the previous 13+/Privy conflict. No age-assurance or parental-control mechanism is claimed.                                                                                                                                                                                                                                                                                                                            |
| Content rights      | Owner confirmed the necessary rights to displayed assets/content and authorized repository/machine access. Apple's declaration reads `USES_THIRD_PARTY_CONTENT`. [Readback and authorization](launch-policy.json) record both launch-policy decisions.                                                                                                                                                                                                                                                                                                    |
| Apple provider      | Primary App ID enabled, Services ID `xyz.hologram.concors.auth` and dedicated signing key created; callback `https://auth.privy.io/api/v1/oauth/callback`. Backend signing material stored in production server credentials. Privy Apple is enabled, and the deployed API advertises `apple:true`. The normal production sign-in page generates an authorization request with the correct Client ID/callback; actual Apple account sign-in, token return and device acceptance remain pending. See [activation evidence](apple-provider-activation.json). |
| Durable revocation  | [API PR 23](https://github.com/hologramxyz/concors-server/pull/23) merged/deployed: fresh five-minute Apple client proofs avoid a manual six-month JWT expiry breaking deletion. Signing material is not included here.                                                                                                                                                                                                                                                                                                                                   |
| Native artifact     | [Build 12](https://expo.dev/accounts/guitong35/projects/concors/builds/e633163f-9dc7-40e9-b57e-3ee8d4a15504), **0.1.0 (12)** from main `89efcccb5412af7cd1b18a9fce904e11d3a2bf3d`, is VALID / IN_BETA_TESTING, in Internal beta and attached to draft 0.1.0. [Signed inspection](ios-build-12.json) verifies all nine categories/purposes and preserved SDK reasons.                                                                                                                                                                                      |
| Native screenshots  | One visually inspected **1320 × 2868** native iPhone capture is processed and active in the draft's 6.9-inch set. The native simulator control/draft flow passes; final screenshot selection and production/physical-device acceptance remain pending. See [capture evidence](ios-native-evidence.md); simulator images do not establish physical-device acceptance.                                                                                                                                                                                      |

## Remaining release blockers

1. **Production Apple acceptance.** Privy and the deployed API now enable Apple with the correct
   Concors Services ID/callback. A normal browser generates the matching authorization request; no
   Apple account authentication or token exchange has been completed by this check. Verify return
   of OAuth tokens, first-time/returning sign-in, Hide My Email, cancellation and revocation on a
   signed iPhone. Keep allowed domains. See [activation evidence](apple-provider-activation.json).
2. **Reviewer workspace.** The dedicated email login is verified and saved privately in Apple.
   Assign an isolated, connected machine and working AI-provider access that remain available
   throughout review; the reviewer account currently has no machines. Do not expose a customer's
   workspace, a developer host or the agent's credentials. Verify the exact review route and deletion
   on a separate disposable account before final handoff. Keep Privy test accounts enabled throughout
   review: disabling/re-enabling rotates the credentials, which would require updating Apple's fields.
3. **Screenshots and real device acceptance.** Finish the native screenshot set and interaction checks.
   Complete install/upgrade, permissions, keyboard, reconnect, accessibility, AI decline/withdrawal,
   support reporting and deletion on a physical iPhone. Native simulator/browser checks alone do not
   establish this acceptance. Confirm support/report triage is operated.

Do not infer readiness from a successful upload. The iOS-only gate file is
[readiness-ios.json](readiness-ios.json); the Android/combined gates remain separate.
`node apps/mobile/scripts/release-check.mjs --platform=ios --json` must continue failing until the
remaining evidence exists. No public App Review or external beta review has been submitted.

## Dedicated reviewer machine proposal — not provisioned

The owner requested a hosting proposal on November 6. This proposal does not authorize a purchase
or establish working reviewer access. The existing reviewer account has no connected machine.

Use a **company-owned OVH US VPS-1**, Ubuntu 24.04, x86_64, **2 vCores / 4 GB RAM / 40 GB disk**,
in Virginia if available. Connect it as an **external machine** to the isolated reviewer
organization through the normal desktop setup. This keeps the reviewer out of machine checkout
and avoids creating a Stripe subscription on the reviewer account. Production already has OVH
credentials and external-machine SSH/daemon configuration; capacity and order availability still
need checking immediately before any approved purchase.

| Item            | Proposed amount / behavior                                                                                                                                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VM              | **USD 5.35 per month**, current US catalog monthly renewal price for `vps-2027-model1`, checked November 6 at 20:12 UTC. The public site advertises a lower starting price; use the live order quote for approval.                                                     |
| AI access       | One supported provider, initially Pi with an Anthropic API key scoped to a new review-only workspace. Set a **USD 20 monthly workspace spend limit**, with a usage alert before exhaustion. The API account must have usable credit and support the selected model.    |
| Proposed budget | **USD 30/month**, including the VM and AI allowance, subject to the final order quote and taxes. No automatic upgrades, paid backup add-ons or additional machines. Usage caps reset on the provider's billing schedule; this is a monthly budget, not a lifetime cap. |
| Availability    | Always on through App Review, follow-up questions and any appeal. Check renewal and AI headroom before submission and monitor during review. Do not schedule shutdown while review is pending.                                                                         |
| Alternative     | A DigitalOcean Basic bundled VM with 2 vCPUs / 4 GiB / 80 GiB is **USD 24/month**, plus AI. It exceeds this proposal's total budget, needs separate approval and account access, and is a fallback if OVH cannot supply the machine.                                   |

Pricing sources: [OVH public US catalog](https://api.us.ovhcloud.com/1.0/order/catalog/public/vps?ovhSubsidiary=US),
[OVH VPS specifications](https://us.ovhcloud.com/vps/),
[DigitalOcean bundled pricing](https://www.digitalocean.com/pricing/droplets), and
[Anthropic workspace limits](https://platform.claude.com/docs/en/manage-claude/workspaces).
These are November 6 observations, not a reserved quote.

The standard Concors installer requires Debian/Ubuntu with systemd and SSH. An ordinary Railway
service container does not satisfy that installation contract without additional engineering.
This proposal uses a separate VM and the existing installation route.

Isolation and operation:

- Give only the reviewer organization access. Seed a small, original sample repository with a
  README, source files, an executable test and a useful starter task. Include no customer code,
  production database access, production environment files, GitHub write token or developer login.
- Install the released daemon and a pinned supported AI CLI; record the versions. Keep the normal
  machine-token checks and TLS. Restrict SSH to the control plane and operator; expose only the
  daemon/preview ports needed by the demonstrated flow. Validate the firewall with the installer.
- Treat the entire VM as disposable. The standard installer grants the `ubuntu` user passwordless
  sudo, and the terminal can read credentials available to its user. A review-only model credential
  must therefore have limited spending and no administration rights; never copy a shared key onto
  this host. Place it through a private operator channel, outside the repository, chat and Apple
  review notes. Verify that the session host inherits it after restart.
- The company supplies the provider account/key and owns the usage. Confirm that its permitted-use
  terms cover this isolated review demonstration. Use the app's normal named-provider AI consent
  before sending the sample code; do not simulate provider responses or bypass permissions.
- Keep health, certificate, heartbeat, disk and AI-credit checks running, with alerts to an operated
  support contact. Start from a saved sample-repository revision so an operator can restore the
  exercise without rotating the review login or deleting an active session unexpectedly.

After purchase approval and secure provider setup, acceptance must demonstrate the **exact saved
reviewer login on the signed iPhone**, machine discovery, a real agent response, file inspection,
a permitted edit, terminal/test execution, app background/reconnect, and renewed machine access
after token expiry. Verify deletion on a separate disposable account rather than deleting the
App Review account. Capture the final screenshots from this working route, then update Apple's
private review notes with the machine, sample task and recovery/contact instructions.

After review is closed, revoke the dedicated model key, detach the external machine, destroy the
VM and its backups, and verify that provider billing/renewal stopped. Removing an external machine
from Concors alone does **not** destroy the VPS or stop its hosting bill.

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
