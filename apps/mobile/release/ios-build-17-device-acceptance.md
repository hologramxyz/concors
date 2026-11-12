# iPhone 0.1.1 (17) — owner acceptance and App Review receipt

On November 12, 2026, the release owner was told that **0.1.1 (17)** was available in the
existing TestFlight internal group and was asked:

> After trying it, how are the drawers, keyboard and PDF previews?

The owner replied: **“Looks good on my iPhone.”** This confirms the requested physical-device
check of drawers, keyboard and PDF previews for this build. The device model and iOS version
were not provided. Additional physical scenarios retain their existing evidence and scope.

This supersedes the earlier 0.1.1 build-preparation note that a new physical iPhone check had not
yet been recorded. It does not add a claim of a fresh personal Apple-consent/grant exchange.

## App Review

Apple accepted **0.1.1 (17)** for App Review on **2026-11-12 at 06:23:18 UTC**. A readback
confirmed both the review submission and the app version are `WAITING_FOR_REVIEW`, with
`AFTER_APPROVAL` automatic release selected. The public App Store still serves 0.1.0 until Apple
approves and distributes this update.

- App: `6817622624` / `xyz.hologram.concors`.
- App Store version: `e3ebb5e1-7ae4-43ae-a3f0-f888508a350d`.
- Apple build: `e1fa8700-e07e-4cb0-8087-04888264bcf8`, `VALID` / `IN_BETA_TESTING`.
- Review submission: `3793dcb7-be1b-4130-8781-3f23833c0c82`.
- [Signed build](https://expo.dev/accounts/guitong35/projects/concors/builds/69b80002-3a25-4816-bbee-dae982bc8bf0):
  source `1d2d2bf5312d92e3c79fd65bc6cf245cc2ecc03b`, inspected before upload.
- Release preparation: [PR #213](https://github.com/hologramxyz/concors/pull/213), merged after all
  19 PR checks passed. Later release-record commits do not change the shipped runtime.

The four processed store screenshots and private reviewer access instructions were preserved.
Fresh production email/PKCE sign-in, authenticated reviewer-machine access and a fixture-file read
passed. Private credentials, tokens and artifact download URLs are excluded from this record.
