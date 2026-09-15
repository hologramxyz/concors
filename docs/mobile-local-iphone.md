# Install Concors Dev on your iPhone while Apple enrollment is pending

Use your **Mac, Xcode and free Apple Account (Personal Team)**. This is local development,
not TestFlight, an App Store upload or an EAS cloud build. No Expo login/project is needed.
Apple's free provisioning expires after seven days, so rebuild/reinstall when it expires.
[Apple's Personal Team rules](https://developer.apple.com/help/account/basics/about-your-developer-account),
[Expo's local build guide](https://docs.expo.dev/develop/development-builds/introduction/).

## First-time setup on your Mac

1. Install **full Xcode**, open it, accept its license, and complete first-run/iOS platform
   installation. Command Line Tools alone are insufficient. Use an Xcode version that supports
   this repository's Expo SDK 57 and your phone's iOS; the cloud reference uses Xcode 26.6.
2. In **Xcode → Settings → Apple Accounts**, add your Apple Account. Choose its **Personal Team**
   for local signing, not your pending organization membership. Never send passwords or keys in chat.
3. Connect/unlock your iPhone by USB, trust the Mac, and enable **Settings → Privacy & Security →
   Developer Mode** on the iPhone (restart/confirm if requested). Keep Mac and iPhone on the same
   reachable Wi-Fi for Metro. The Mac firewall must allow Node's development server.
4. Install Node 24 and pnpm 11.1.1. Use a fresh checkout or preserve your existing work before
   switching branches. From the repository root:

```bash
git fetch origin
git switch feat/mobile-testflight-beta
git pull --ff-only
pnpm install --frozen-lockfile
pnpm --filter @concors/mobile ios:local
```

The command builds shared desktop assets, generates/updates iOS without `--clean`, installs
Pods, asks which device to use, builds/installs **Concors Dev**, and starts Metro. Allow time for
the first native compile. Open the app, sign in with the same account you use on the development
backend, and select an existing machine. Remote machines/daemons must be reachable separately.

The approved default API is **https://concors-server-dev.up.railway.app**. This is a real login,
not a demo/private-daemon shortcut. On 2026-09-15 its account endpoint returned expected JSON
401 without credentials; successful sign-in/workspace use still needs testing with your account.

## If automatic signing needs setup

If Expo reports no signing certificate/team or Xcode asks for signing setup:

```bash
pnpm --filter @concors/mobile ios:local prepare
```

Open the `.xcworkspace` in `apps/mobile/ios` (not `.xcodeproj`). Select the **Concors Dev app
target → Signing & Capabilities**, enable **Automatically manage signing**, select your
**Personal Team**, and select your connected iPhone as the run destination. The local target
must not have Push Notifications or Associated Domains enabled. This profile removes both
entitlements; don't re-enable them while using free signing.

In another terminal, from the repository root:

```bash
pnpm --filter @concors/mobile ios:local start
```

Then press **Run** in Xcode. If iOS asks you to trust the developer, follow its prompt under
**Settings → General → VPN & Device Management**. This signs only for development on your
own device; do not export/upload the result as a store build.

If Apple says the bundle ID is unavailable, choose your own identifier **before prebuilding**:

```bash
export CONCORS_IOS_BUNDLE_IDENTIFIER=dev.yourname.concors
# Optional: your own 10-character team ID, as shown by Xcode:
# export CONCORS_IOS_TEAM_ID=YOURTEAMID
pnpm --filter @concors/mobile ios:local
```

Use that same identifier on subsequent runs. Changing it installs a separate app and its saved
session/preferences will be separate. The default is `dev.concors.mobile.local`; the shipping
`dev.concors.mobile` and existing `.preview` IDs are deliberately reserved.

## Daily use and limitations

- Keep the `ios:local`/Metro terminal running and the Mac reachable. This **Debug** build loads
  JavaScript from the Mac; it is not yet a standalone TestFlight install for use away from it.
  To reopen later, run `pnpm --filter @concors/mobile ios:local start` and launch Concors Dev.
- Chat, files, terminal, native keyboard/glass and desktop sync are available for testing.
  Creating/purchasing VPSs stays on desktop. Push notifications and universal links are disabled
  in this local profile, including push registration if the backend advertises support.
- The helper overrides stale demo/private/production settings and ignores `.env.local`, so a
  leftover TestFlight file cannot silently change the build. To intentionally change only this
  build's API, export `CONCORS_IOS_API_URL` with an HTTPS URL. Never put credentials in it.
- The helper regenerates native configuration but never deletes `ios/`, resets source or alters
  the production API. Native generated files and signing credentials remain gitignored. Avoid
  mixing hand-maintained native changes and prebuild in the same checkout.
- Rebuild/reinstall after the free signing period expires. Once membership activates, use the
  separate [TestFlight runbook](mobile-testflight.md) for a signed standalone beta and easy updates.

Preparation is verified through config introspection/tests on Linux. Compilation, Personal Team
signing and installation must run on your Mac; no physical iPhone installation is claimed here.
