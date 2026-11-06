# iPhone beta through TestFlight

Apple enrollment still pending? Use the [local Mac → iPhone development path](mobile-local-iphone.md)
with a free Personal Team first. The approved API for the mobile app is
`https://api.concors.dev`, including the TestFlight candidate.

This is the **internal beta** path, not a public App Store release. Use `candidate`: production
identity, store distribution, no demo/private-daemon override, automatic build-number increments.
Do not use `preview`: EAS `distribution: internal` means ad hoc, not TestFlight internal testing.
See [Expo's TestFlight guide](https://docs.expo.dev/submit/testflight/).

The shared desktop workspace is bundled in the app; Metro, Expo Go and the browser preview are
not required. Internet access and a reachable authenticated daemon are still needed. Mobile signs
in to **existing accounts/machines**; creating/purchasing VPSs remains on desktop. Use a dedicated
test account/machine. iPhone dictation records through the machine, as on desktop. The machine needs
its speech model, a 660 MB background download.

## Current state

On 2026-10-23, this checkout was replaced with a fresh clone of
`https://github.com/hologramxyz/concors.git`, at main
`c127806a4eaa69a2c420945567a594cb8307484e` (desktop and daemon 0.8.1). The old checkout,
Git objects, installed dependencies and generated assets were removed. Local environment files
were backed up outside the repository; the mobile release settings were recreated from the
known Hologram identifiers rather than copying the old source or Git metadata.

On 2026-11-04, the checkout was fast-forwarded to latest main
`aa3a9fddbbbc08994a14868910446f0064f3ed3a` (desktop and daemon 0.12.0), preserving the
Hologram mobile identity and signing configuration.

The Expo project is [Hologram's `@guitong35/concors`](https://expo.dev/accounts/guitong35/projects/concors),
ID `b928233e-14cd-4e58-95e5-b19d8101bcb6`. The Apple record is
[Concors: Coding Workspace](https://appstoreconnect.apple.com/apps/6817622624), ID `6817622624`,
on Rolling Inc. team `9WN4P724M2`, using bundle ID `xyz.hologram.concors`.
The record includes iOS and macOS; this runbook builds and uploads the iPhone app.
The macOS store build is a separate task; the existing desktop DMG uses `dev.concors.desktop`.

Shared desktop UI changes are bundled automatically. Native startup uses the brand mark during
session restoration. Settings → Diagnostics shows the phone's version/build and actual API.

The [latest candidate](https://expo.dev/accounts/guitong35/projects/concors/builds/9d2ba696-a9e4-4f81-bbb9-63a31714639d)
is **0.1.0 (7)**. Its signed IPA was inspected for the latest source revision
`aa3a9fddbbbc08994a14868910446f0064f3ed3a`, bundle ID, build number, Apple team,
production API, photo picker and microphone purpose configuration. The iOS workspace origin
is embedded, and the camera purpose string remains absent. The workspace test suites passed
with **1,602 passed and two skipped**. Seven targeted mobile browser checks passed across the
initial run and a focused rerun, covering files, sub-agent rendering, tab controls, last-tab
restoration, dictation and its keyboard fallback, and the native surface bridge. Six passed in
the initial run; the tab-picker flow reached its final close-tab action before the 60-second
test limit and passed the same assertions on a focused rerun with a 90-second limit. Formatting,
lint, workspace type checks and the online beta preflight passed.
The [TestFlight upload](https://expo.dev/accounts/guitong35/projects/concors/submissions/a975378e-4a5b-41b3-87ed-c00c4c5a34da)
completed on 2026-11-04. Apple reports the build **VALID / IN_BETA_TESTING**, and its assignment
to the existing **Internal beta** group was verified through Apple's API. The owner remains a
tester in that group. Physical-device acceptance remains pending.

The owner approved `https://api.concors.dev`; new candidate/production builds pin
that API explicitly. Accounts on the old development server are not automatically migrated.
The update requires a fresh sign-in: native sessions are now bound to their issuing API and
unscoped legacy tokens are not reused when changing backends.
Native sign-in must send an Origin accepted by the configured API, without disabling the server's
CSRF checks. Full account/workspace and physical-device acceptance remains pending in the
[release checklist](mobile-release.md); installation alone does not verify those gates.

## 1. Account setup

- Use the registered identifier `xyz.hologram.concors` and App Store Connect app `6817622624`.
  The App Store listing name may include a tagline; the installed app remains **Concors**.
- Use the team's existing [Expo project `@guitong35/concors`](https://expo.dev/accounts/guitong35/projects/concors),
  slug `concors`, project ID `b928233e-14cd-4e58-95e5-b19d8101bcb6`. Do not create a duplicate project.
  App config defaults to this project; explicit environment overrides remain supported, including
  the empty values used to keep Personal Team builds unlinked.
- Create an internal TestFlight group and give the tester eligible App Store Connect access to
  this app. The account holder can test their own app. Other testers require external testing and
  potentially Beta App Review. See [Apple's internal tester instructions](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers).

Share only the project URL/owner and numeric app ID in chat/PRs. Enter passwords, 2FA and signing
keys privately in Apple/Expo tooling, never in source or chat.

## 2. Configure the beta

With Node 24 / pnpm 11.1.1, create gitignored `apps/mobile/.env.local` using real values:

```dotenv
APP_VARIANT=production
EXPO_PUBLIC_DEMO=false
EXPO_PUBLIC_API_URL=https://api.concors.dev
EXPO_PUBLIC_EAS_PROJECT_ID=b928233e-14cd-4e58-95e5-b19d8101bcb6
EXPO_OWNER=guitong35
CONCORS_ASC_APP_ID=6817622624
```

Do not include `EXPO_PUBLIC_DEV_DAEMON_URL` or `CONCORS_MOBILE_WEB_BASE_PATH`. The checker reads
this file; exported shell values take precedence. Rename/remove it before resuming demo work.

```bash
cd apps/mobile
pnpm testflight:check
# Optional configuration-only report (no reachability claim):
pnpm testflight:check --offline --json
```

The online check expects JSON 401 from `/api/v1/me` **without credentials**, catching DNS/TLS,
redirects, unavailable servers and accidental marketing URLs. It does not sign in, provision,
verify account ownership or sign/upload a build. To verify actual account/machine metadata, run
`pnpm live:preflight` with private environment variables `CONCORS_PREFLIGHT_TOKEN`,
`CONCORS_PREFLIGHT_MACHINE_ID` and `CONCORS_PREFLIGHT_API_URL` (the same API as the beta).
Do not paste tokens into command arguments or a PR. This still does not prove phone acceptance.

## 3. Build a signed candidate

From `apps/mobile`:

```bash
pnpm dlx eas-cli@24.4.1 login
pnpm dlx eas-cli@24.4.1 project:info
```

Confirm the owner/project. In its **production EAS environment**, configure the same
`EXPO_OWNER`, `EXPO_PUBLIC_EAS_PROJECT_ID` and `EXPO_PUBLIC_API_URL` as plain-text variables.
The candidate profile explicitly pins `EXPO_PUBLIC_API_URL=https://api.concors.dev`, sets the
production variant, and disables demo. Keep the cloud API variable aligned; preflight rejects a
local API that differs from the candidate. Local `.env.local` is gitignored and does not replace
cloud variables. Never put credentials in `EXPO_PUBLIC_*`.

`submit.candidate.ios.ascAppId` and `submit.production.ios.ascAppId` in `apps/mobile/eas.json`
already target Apple app `6817622624`. This is a public identifier, not an Apple login.
Preflight rejects disagreement with `CONCORS_ASC_APP_ID`.

```bash
pnpm testflight:check
pnpm dlx eas-cli@24.4.1 build --platform ios --profile candidate
```

Follow Apple's signing prompts privately. EAS uses cloud macOS workers; this path does not need
a local Mac. Do not auto-submit or mark pending gates verified to get a build through. `candidate`
allows device evidence to be collected before public release approval. Its bundle ID is
`xyz.hologram.concors`, not `.preview`.

Use EAS CLI 24.4.1 or newer: 24.4.0 can fail Apple authentication with
`iTunes service key is empty` ([upstream fix](https://github.com/expo/eas-cli/issues/4392)).
If signing needs to be configured separately, run
`pnpm dlx eas-cli@24.4.1 credentials:configure-build --platform ios --profile candidate`
in an interactive terminal. Enter Apple credentials and 2FA there, not in chat.

The shared iOS build profile sets `SHARP_IGNORE_GLOBAL_LIBVIPS=1` before dependency installation.
This keeps Sharp on its packaged binaries instead of compiling against the Mac builder's global
libvips. Leave dependency lifecycle scripts and release checks enabled; this is a build-tool
setting, not an app permission or signing change.

Record build URL/ID, source commit, version/build, API and signing team; inspect logs and artifact
metadata. A JS export or unsigned prebuild is not an installable IPA. GitHub runners are available
again as of November 6, 2026; inspect the actual native job results separately. Check EAS account/build
availability independently.

## 4. Upload exactly that build and install

```bash
# Replace the UUID; avoid --latest when multiple builds may exist.
APP_VARIANT=production pnpm dlx eas-cli@24.4.1 submit --platform ios --profile candidate --id YOUR-EAS-BUILD-UUID
```

Set `APP_VARIANT=production` explicitly for standalone submission: unlike build, submit does not
load the build profile's environment. Otherwise credential lookup can use the preview bundle ID.
If upload credentials need setup, run
`APP_VARIANT=production pnpm dlx eas-cli@24.4.1 credentials --platform ios`, choose `candidate`,
then **App Store Connect: Manage your API Key → Set up your project to use an API Key for EAS Submit**.
Enter Apple credentials privately. Standard uploads need no automated release notes: if Expo
rejects `--what-to-test` as Enterprise-only, omit it and add notes/groups directly in App Store Connect.

[EAS Submit](https://docs.expo.dev/submit/ios/) uploads to the selected Apple app, not to a public
release. After processing, answer compliance questions accurately, add the build to the internal
group, and invite the tester. On iPhone install Apple's **TestFlight**, accept the invitation and
install **Concors**. No preview URL/QR code is needed. A privately networked machine may still
need Tailscale. Do not request external beta review or public distribution as part of this flow.

TestFlight builds last 90 days, enough for this two-week trial.
[Apple's testing rules](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers).

## Two-week acceptance checklist

Record iPhone/iOS version and Diagnostics version/build with each report. Use TestFlight feedback
without private code, credentials or personal data in screenshots.

- First install: Concors icon/name, light/dark startup, real sign-in, cancelled sign-in, offline/retry,
  force-close/session restoration. No demo in candidates. Confirm the native AI-sharing permission names recipients before applicable requests; decline, withdrawal and changed configurations must be tested.
- Desktop sync: same organization/machine/workspaces; harmless chat and terminal from both clients;
  tabs/panes and files stay in sync. No VPS purchase on phone.
- Native UI: glass and older-iOS fallback; square/subtle/rounded themes; sidebar/Files swipes;
  search/account/settings drawers; keyboard/safe areas; VoiceOver, large text and reduced motion.
- Daily use: send/stop/queue, tool approval, attachments/cancel, dictation (allow and deny the
  microphone, Send, Edit, Cancel, leaving the app while recording), long output,
  file browse/Markdown/edit/save/unsaved-change warnings. Use a test repository.
- Lifecycle: Wi-Fi ↔ cellular, airplane mode/retry, lock/background/foreground, test-daemon restart,
  token expiry, team switch, sign-out and different-account sign-in without previous-account data.
- Update: install build N+1 through TestFlight; verify preferences/session and desktop sync.
  Test a clean install separately. Agents keep running while the app is closed.
- Optional services: only promise/test push and deletion when a functioning backend advertises
  them. Do not mark unimplemented features verified.

### Navigation and sign-in regression pass

Run these on the newly built candidate, not an older installed TestFlight binary:

1. With the keyboard hidden, verify sidebar, Search and Files icon buttons share a compact
   44-point frame. Check rounded, subtle and square themes, including Reduce Transparency.
2. Slowly drag the workspace right, pause halfway, and reverse direction. Search must stay
   behind the moving workspace; its menu button remains visible but does not activate through
   the return-to-workspace scrim. The workspace edge should have only a subtle glass highlight.
3. Drag Files in from the right and back out, including from a terminal. Its back button and
   directory title travel with Files throughout the gesture; underlying controls do not float above it.
4. Check sidebar and Files backgrounds behind the notch and home indicator. Controls stay in
   the safe area; opening and dismissing the keyboard must not leave a blank bottom band.
5. Sign out and tap **Sign in**. On the sign-in page, try GitHub, Google and an emailed code;
   verify successful return to the app, cancellation, and a GitHub account without a verified
   email, without exposing callback codes or credentials in feedback.
   Force-close and cold-launch while signed out: **Sign in** must appear after discovery
   finishes, without needing an existing saved session. Repeat in airplane mode: discovery
   eventually offers **Retry**, rather than silently hiding the button. Restore connectivity
   and retry, then repeat recovery by backgrounding/foregrounding without restarting.
6. Open the machine picker, then Manage machines. Also test an account with no machines.
   This provides setup navigation, not VPS provisioning: new machines still require desktop
   setup under the existing companion scope. Do not record this as mobile machine creation.

Browser geometry/bridge tests cover clipping and safe-area calculations, but cannot verify
SwiftUI glass rendering, device keyboard behavior or a real browser sign-in callback. Record
those separately on the physical device before marking them passed.

After testing, record real evidence in `apps/mobile/release/readiness.json` and address the
[submission packet](../apps/mobile/release/submission-packet.md). The beta does not approve
privacy disclosures, public pages, app links, recovery/deletion or storefront policy.
