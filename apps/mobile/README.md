# Concors mobile

One React Native / Expo SDK 57 client for iPhone and Android: Expo Router, SecureStore,
Expo Notifications, and the existing Concors API/daemon protocol. The terminal is
bundled xterm.js in an isolated offline WebView, not a remote website.

**Status: client implementation and testable preview; not store-submission ready.**
Production connectivity, push and deletion require the [server contracts](../../docs/mobile-backend.md).
Signed builds require team-owned developer accounts. See the [release runbook](../../docs/mobile-release.md).

## Try it now — no daemon or account needed

From the repository root, with Node 24 and pnpm 11.1.1:

```bash
pnpm install --frozen-lockfile
pnpm mobile:demo
```

Open the URL printed by Expo (normally <http://localhost:8081>) in browser phone-size
device mode. Select **Explore demo → Development → Agent conversation**. Approve the
request and send a message. Go back and open **Terminal 2** to try input, extra keys,
reload, and explicit stop confirmation. Commands/responses are simulated through real
protocol schemas. Creation is deliberately unsupported in this fixed fixture. Refresh
resets the demo and signs you out; browser credentials are held only in memory.

## Run on a phone / simulator

Install [Xcode or Android Studio prerequisites](https://docs.expo.dev/guides/local-app-overview/).
Use development builds, **not Expo Go**, for the complete native integration.

```bash
# macOS + Xcode: iOS simulator (add --device for an attached iPhone)
EXPO_PUBLIC_DEMO=true pnpm --filter @concors/mobile ios
# Android Studio + emulator or USB-debugging device
EXPO_PUBLIC_DEMO=true pnpm --filter @concors/mobile android
```

On PowerShell, set `$env:EXPO_PUBLIC_DEMO="true"` before the command instead. Stop and
restart Metro when changing demo/real environment variables. Alternatively use EAS
development/simulator builds after linking the team's Expo project (release runbook).
Native push needs physical devices, APNs/FCM credentials and the push service; the demo
cannot test real delivery.

## Connect to the real service

Create `apps/mobile/.env.local` using `.env.example` as a guide. Set the real HTTPS
`EXPO_PUBLIC_API_URL`, disable `EXPO_PUBLIC_DEMO`, then restart with `pnpm mobile:dev`.
The current server supports native bearer sign-in and machine inventory. Missing
mobile capabilities show remote access/push/deletion as unavailable; other failures
remain visible/retryable.

For private integration tests only, `EXPO_PUBLIC_DEV_DAEMON_URL` accepts a clean WSS
gateway URL. This override provides **no authentication itself**: use an already
protected private network/gateway, never expose a bare daemon publicly. It requires
a real signed-in account/machine selection and bypasses cloud ticket/machine-ID checks.
Production ignores it. It is not a production access mechanism.

`EXPO_PUBLIC_*` values ship in the app: never put secrets in them. Native session tokens
use device-only secure storage, hydrated before requests. Transcripts/workspace/terminal
buffers are in-memory on the phone; the daemon remains authoritative.

## Implemented scope

- Existing-account sign-in/restoration, organization switching and sign-out.
- Machine inventory, capability-gated WSS tickets, projects/tabs/panes; mobile navigation
  preserves desktop split geometry.
- Create chat/shell/Codex/Claude Code/OpenCode tabs in existing projects; start/recover
  sessions through the daemon. Unified chat follows the daemon's Codex adapter only.
- Streamed chat/history, tool details, approvals/questions, queue/interrupt and advertised
  model selection.
- Terminal replay, sequence-gap resync, ownership/input/resize, extra keys, renderer
  reload, detach-on-leave and separately confirmed process stop.
- Foreground/network reconnect with fresh tickets/snapshots, no background socket
  assumption or automatic replay of user mutations.
- Opt-in push registration/refresh/revocation, validated notification navigation and
  account-deletion confirmation, all capability-gated.
- Light/dark presentation, labeled controls, large touch targets and existing-brand icons.

Project creation/cloning, provisioning/payment, server previews and arbitrary layout
editing stay in desktop for this companion release. Cross-organization notification
links require selecting that organization first. Unauthorized/stale destinations fail closed.

## Verification

```bash
pnpm mobile:test
pnpm --filter @concors/api-client test
pnpm --filter @concors/mobile typecheck
pnpm exec playwright install chromium
pnpm test:mobile:e2e
pnpm mobile:build
```

`mobile:build` exports iOS/Android Hermes bundles and web assets, **not signed IPA/AABs**.
Browser tests exercise the fixture and terminal bridge, not real APNs/FCM or a live daemon.
See the release runbook for the required native/manual matrix.

`app/` contains routes; `src/` separates agents, terminal, auth, platform adapters and the
opt-in demo. `packages/client-core` shares lifecycle, token persistence, notification
validation and transcript merging. No client imports daemon/Tauri implementations.
`pnpm assets` generates icons from the existing desktop SVG and offline terminal HTML
from installed xterm packages. HTML and native `ios/`/`android/` projects are generated
and ignored. Expo-native peers are pinned to avoid incompatible automatic resolution.
