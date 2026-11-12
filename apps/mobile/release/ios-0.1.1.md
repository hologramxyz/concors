# iPhone 0.1.1 update

The release owner requested publication of the merged mobile improvements on November 12, 2026.
The source baseline is main `8fb866f89257166aa75483b1a68fb858ff404aec`, including the mobile
production polish, model drawer and visual refinement from #206, #207, #210 and #211.

Apple's production record was read back on November 12: app `6817622624`, bundle
`xyz.hologram.concors`, version 0.1.0, build 16, `READY_FOR_SALE`. Public lookup also reports 0.1.0.
The [authentication baseline](ios-0.1.1-auth-baseline.json) reconciles the historical hold with
the now-approved, live version and the owner's instruction to publish this UI update. Native
sign-in, app configuration and plugins are unchanged from build 16. Fresh production email/PKCE
sign-in and authenticated reviewer-workspace access passed. The record retains the unobserved
personal Apple-consent exchange and does not claim new physical iPhone acceptance.

## What's New

- A calmer startup and smoother sidebar navigation.
- Consistent bottom drawers for model selection, Settings and schedule choices.
- A refined message composer with a microphone when empty and Send when you write.
- PDF previews for project files and chat attachments.
- Clearer Settings, improved empty states and persistent messaging preferences.

## Signed build

[EAS build 17](https://expo.dev/accounts/guitong35/projects/concors/builds/69b80002-3a25-4816-bbee-dae982bc8bf0)
completed from source `1d2d2bf5312d92e3c79fd65bc6cf245cc2ecc03b`. The
[artifact inspection](ios-0.1.1-artifact.json) confirms its version/build, store identity, production
API and push entitlements, permission descriptions, privacy manifest, source revision and bundled
mobile improvements. Metadata recorded after that commit does not change the built application.

The release preflight passes after reconciling the shipped authentication baseline. Fresh
reviewer sign-in and workspace access passed, all four public support/privacy/deletion/terms URLs
returned HTTP 200, and the authenticated mobile capability still enables production push.

Apple upload and native simulator acceptance are in progress. Existing physical-device evidence
remains identified by its original version and verification date; this update does not claim a
new physical iPhone run.
