# iPhone beta through TestFlight

Apple enrollment still pending? Use the [local Mac → iPhone development path](mobile-local-iphone.md)
with a free Personal Team first. The approved development API is
`https://concors-server-dev.up.railway.app`; this does not change the production default.

This is the **internal beta** path, not a public App Store release. Use `candidate`: production
identity, store distribution, no demo/private-daemon override, automatic build-number increments.
Do not use `preview`: EAS `distribution: internal` means ad hoc, not TestFlight internal testing.
See [Expo's TestFlight guide](https://docs.expo.dev/submit/testflight/).

The shared desktop workspace is bundled in the app; Metro, Expo Go and the browser preview are
not required. Internet access and a reachable authenticated daemon are still needed. Mobile signs
in to **existing accounts/machines**; creating/purchasing VPSs remains on desktop. Use a dedicated
test account/machine. iPhone dictation uses the keyboard microphone, not desktop's browser recorder.

## Current state

Based on desktop main `16fbab0` (PRs #102–104). Shared chat/dictation changes are bundled
automatically; native startup now uses the brand mark during session restoration. Settings →
Diagnostics shows the phone's version/build and actual API instead of desktop's default URL.

On 2026-09-15, this environment had no Expo login, owner/project ID or Apple app ID.
`api.concors.dev` failed DNS resolution here. The existing desktop development backend returned
JSON HTTP 401 for an unauthenticated account request. **The owner must confirm the beta backend**
and verify a real account/machine on it. No automatic fallback to a development server was added.
No signed IPA, TestFlight upload or physical-device acceptance is claimed. Full release gates
remain pending in the [release checklist](mobile-release.md).

## 1. Account setup

- Confirm active Apple Developer membership/agreements. Create identifier `dev.concors.mobile`
  and a **Concors** iOS app in App Store Connect using that bundle ID. Save its **numeric Apple ID**.
- Create/link the team's Expo project, slug `concors-mobile`. Save the owner and project UUID.
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
EXPO_PUBLIC_API_URL=https://YOUR-CONFIRMED-BACKEND
EXPO_PUBLIC_EAS_PROJECT_ID=YOUR-EXPO-PROJECT-UUID
EXPO_OWNER=YOUR-EXPO-OWNER
CONCORS_ASC_APP_ID=YOUR-NUMERIC-APPLE-APP-ID
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
pnpm dlx eas-cli@24.4.0 login
pnpm dlx eas-cli@24.4.0 project:info
```

Confirm the owner/project. In its **production EAS environment**, configure the same
`EXPO_OWNER`, `EXPO_PUBLIC_EAS_PROJECT_ID` and `EXPO_PUBLIC_API_URL` as plain-text variables.
The candidate profile already sets the production variant and disables demo. Local `.env.local`
is gitignored and does not replace cloud variables. Never put credentials in `EXPO_PUBLIC_*`.

Set `submit.candidate.ios.ascAppId` in `apps/mobile/eas.json` to the real numeric Apple app ID
as a string. This public identifier may be committed once known; until then EAS Submit asks
interactively. Preflight rejects disagreement with `CONCORS_ASC_APP_ID`.

```bash
pnpm testflight:check
pnpm dlx eas-cli@24.4.0 build --platform ios --profile candidate
```

Follow Apple's signing prompts privately. EAS uses cloud macOS workers; this path does not need
a local Mac. Do not auto-submit or mark pending gates verified to get a build through. `candidate`
allows device evidence to be collected before public release approval. Its bundle ID is
`dev.concors.mobile`, not `.preview`.

Record build URL/ID, source commit, version/build, API and signing team; inspect logs and artifact
metadata. A JS export or unsigned prebuild is not an installable IPA. GitHub native CI was billing
blocked; resolve that before rerunning those jobs. Check EAS account/build availability separately.

## 4. Upload exactly that build and install

```bash
# Replace the UUID; avoid --latest when multiple builds may exist.
pnpm dlx eas-cli@24.4.0 submit --platform ios --profile candidate --id YOUR-EAS-BUILD-UUID
```

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

- First install: Concors icon/name, light/dark startup, real sign-in, wrong password, offline/retry,
  force-close/session restoration. No demo or extra consent/onboarding page.
- Desktop sync: same organization/machine/workspaces; harmless chat and terminal from both clients;
  tabs/panes and files stay in sync. No VPS purchase on phone.
- Native UI: glass and older-iOS fallback; square/subtle/rounded themes; sidebar/Files swipes;
  search/account/settings drawers; keyboard/safe areas; VoiceOver, large text and reduced motion.
- Daily use: send/stop/queue, tool approval, attachments/cancel, keyboard dictation, long output,
  file browse/Markdown/edit/save/unsaved-change warnings. Use a test repository.
- Lifecycle: Wi-Fi ↔ cellular, airplane mode/retry, lock/background/foreground, test-daemon restart,
  token expiry, team switch, sign-out and different-account sign-in without previous-account data.
- Update: install build N+1 through TestFlight; verify preferences/session and desktop sync.
  Test a clean install separately. Agents keep running while the app is closed.
- Optional services: only promise/test push and deletion when a functioning backend advertises
  them. Do not mark unimplemented features verified.

After testing, record real evidence in `apps/mobile/release/readiness.json` and address the
[submission packet](../apps/mobile/release/submission-packet.md). The beta does not approve
privacy disclosures, public pages, app links, recovery/deletion or storefront policy.
