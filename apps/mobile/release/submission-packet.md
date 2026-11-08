# iPhone application prepared — Apple account sign-in pending

Updated November 8, 2026 against [Apple's App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), App Store Connect, the signed native artifact and production services.
This packet concerns iOS. The separate macOS draft has no reviewed Mac App Store binary.

App: [Concors: Coding Workspace](https://appstoreconnect.apple.com/apps/6817622624),
bundle `xyz.hologram.concors`, paid Apple team `9WN4P724M2` (Rolling Inc.), Expo `@guitong35/concors`.
The owner selected free launch, existing machines added on desktop, all available countries,
**concors.dev**, **gm@hologram.xyz**, **Rolling Inc.**, and **16+**. Necessary content rights were confirmed.
There has been no prior rejection. Earlier history remains in [the November 4–5 audit](audits/2026-11-04-05.md).

## Prepared in Apple

| Area                     | Verified preparation                                                                                                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listing                  | iOS 0.1.0 has the chosen name, subtitle, description, keywords, promotional copy, concors.dev marketing/support/privacy URLs and 2026 Rolling Inc. copyright.                                                                                        |
| Build                    | [TestFlight 0.1.0 (16)](ios-build-16.md), VALID / IN_BETA_TESTING in Internal beta and attached to the iOS draft. The executable and profile have production APNs entitlements; ExpoUI is 57.0.26 without duplicate native modules.                  |
| Screenshots              | One [required medium-display capture](ios-medium-screenshots.md) is processed and ACTIVE; the outdated large-display Tabs image is no longer placed. The fresh iPhone 17 Pro native control/composer flow passed.                                    |
| Reviewer                 | Fresh normal production email-code/PKCE login passed November 8. The same private login/code and contact fields remain saved in Apple. Updated notes explain the connected machine, working AI, permissions, terminal/files, reporting and deletion. |
| Privacy                  | Nine linked categories, app functionality and the documented Privy analytics purposes; no tracking. Signed manifest and required-reason APIs are inspected. See [privacy disclosures](privacy-disclosures.md).                                       |
| Price / availability     | Free in all 175 selected territories, including future territories; actual regional eligibility remains subject to Apple. No iPhone commerce.                                                                                                        |
| Rating / rights          | Owner-approved 16+; Apple SIXTEEN_PLUS override and content-rights declaration saved. [Launch policy](launch-policy.json).                                                                                                                           |
| Agreements / credentials | Free-app agreement verified Active on November 6; trader declaration saved. Dedicated Concors submit and production APNs credentials are assigned. Existing unrelated Apple push keys were preserved.                                                |

Apple now reports **READY_FOR_REVIEW** for the version and its review item. This is an unsubmitted
review draft: `submittedDate` is null and the submission flag was never set.
[Apple readback](ios-review-draft.json) identifies the staged build 16 item.

The [final screenshot selection](ios-final-store-assets.json) contains only the current native
medium-display image. The retired large image remains in the library for history.

No public App Review or external beta review has been submitted. The local draft record is
[app-store-connect-draft.json](app-store-connect-draft.json); private review credentials are excluded.

## Working reviewer workspace

One company-owned OVH Ubuntu VM, **concors-app-review**, is connected only to the isolated reviewer
organization. **Task Notes** contains an original fictional repository with README, source files
and three passing Node tests. TLS, authenticated machine access, files, terminal input/output,
reconnect and preservation of the same terminal across a gateway restart passed on November 8.
Daemon version is **0.14.0**. See [host proof](review-host.json) and [reviewer access](reviewer-access.json).

**Task Notes → Review agent** has **Pi 1.5.0 / Claude Haiku 4.5** configured with an existing
Hologram Anthropic API key, as the owner requested. An actual AI reply, approved file read,
approved file write and generated-file readback passed through the production Concors protocol.
No AI subscription or new provider account was purchased. The normal AI-sharing permission and
individual tool approvals remain in place.

[The review-only service](reviewer-ai-operations.md) keeps the company key out of the agent's reach.
The agent user has no sudo; a separate operator retains SSH administration. A durable local quota
reserves 25 cents for each allowed request, up to 80 requests/$20 per UTC month. Hosting remains
$5.35/month; the planned total is within the approved $30. The shared provider account's billing and
the source application's credentials were not changed.

After review, disable the local review access, remove the VM's credential copy, detach the machine,
cancel renewal and destroy the VPS/backups. Verify billing stopped. The source company key remains
in use by Hologram and is not a disposable review-only key.

## Production checks completed

- The [push setup](ios-push-activation.md), signed entitlement and production capability are verified.
  The owner confirmed completion delivery, correct-chat navigation and no alert with in-app push off,
  then [accepted the rollout and deferred further push QA](ios-push-owner-acceptance.md).
- [Production account deletion](ios-live-deletion.md) rejected stale authorization/plan state,
  invalidated both fixture sessions and completed Privy/scoped database cleanup through the real
  worker. A synthetic support report was received and resolved. Only an owned disposable fixture
  was deleted; the reviewer account/machine and customer data were unchanged.
- Privacy, terms, support and deletion pages return HTTP 200 and display the chosen contact in the
  browser. The live policy covers the actual providers and optional push processing.
- Seventeen permission regressions and browser decline/withdrawal checks cover withholding new AI
  requests. The owner confirmed saved approval across conversations/reopening on build 13. The
  reviewer now has real Anthropic access. No untested physical withdrawal scenario is claimed passed.
- Native simulator controls and the owner's signed-device reports provide the recorded smoke
  evidence. Additional physical-device edge cases are distinguished from those observed results.

## Sign-in follow-up and verification limits

The [independent sign-in investigation](ios-apple-auth-self-test.md) reproduced and fixed a restored
Privy session bypass, an Apple-token callback race, a dropped grant during email verification and
an API provider-selection gap. Server PR 27 is merged and deployed. All 563 backend tests pass,
including every disposable database suite. Live tests verify fresh Apple authorization is required,
wrong-provider rejection, and working normal reviewer email login/PKCE.

These hosted-page/API fixes apply to existing TestFlight build 16. The owner's successful device
return is recorded; the exact original phone flow is not inferred from the controlled probes.
No additional owner questionnaire or device test is pending.

The [readiness file](readiness-ios.json) retains the production-auth hold because a real personal
Apple consent/grant exchange has not been independently completed. Local signed test tokens and
provider fakes exercise encryption, subject binding and revocation without claiming a real Apple
account authenticated. See [the result record](ios-apple-auth-self-test.json). App Review remains
staged and unsubmitted. Ongoing support/report triage, machine availability and provider quota
checks remain Rolling Inc.'s operating duties.

Review notes explain the actual product boundaries: native bundled interface and renderer;
structured data from authorized machines; commands run on those machines; no public social feed,
user-to-user chat, app marketplace, unrestricted embedded browser or mobile checkout. The review
covers completeness, accurate metadata, free companion scope, sign-in, privacy/deletion and AI
permission. Apple determines the applicable remote-client/software rules and final approval.
